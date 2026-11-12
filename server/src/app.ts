import type { IncomingMessage, ServerResponse } from "node:http";
import { Config, type ServerConfig } from "./config/Config.js";
import { ApiController } from "./controllers/ApiController.js";
import { ApiError } from "./errors/ApiError.js";
import { RateLimiter } from "./middleware/RateLimiter.js";
import { RequestId } from "./middleware/RequestId.js";
import { SecurityHeaders } from "./middleware/SecurityHeaders.js";
import { AuthMiddleware } from "./middleware/requireAuth.js";
import { DeviceRepository } from "./repositories/DeviceRepository.js";
import { LicenseRepository } from "./repositories/LicenseRepository.js";
import { ProfileRepository } from "./repositories/ProfileRepository.js";
import { MemoryDeviceRepository, MemoryLicenseRepository, MemoryProfileRepository } from "./repositories/MemoryRepositories.js";
import { AuthService } from "./services/AuthService.js";
import { DeviceService } from "./services/DeviceService.js";
import { LicenseService } from "./services/LicenseService.js";
import { LocalAuthService } from "./services/LocalAuthService.js";
import { SupabaseService } from "./services/SupabaseService.js";
import { CatalogRepository } from "./catalog/CatalogRepository.js";
import { CatalogApplicationService } from "./catalog/CatalogApplicationService.js";
import { GoogleCatalogDriveClient } from "./catalog/GoogleCatalogDriveClient.js";
import { CatalogSourceRegistry } from "./catalog/CatalogSourceRegistry.js";
import { CatalogRootDiscovery } from "./catalog/CatalogRootDiscovery.js";
import { CatalogSourceRepository } from "./catalog/CatalogSourceRepository.js";
import { ConfiguredCatalogSources, catalogGenreId } from "./catalog/CatalogGenreSources.js";
import { CatalogSourceAdminService } from "./catalog/CatalogSourceAdminService.js";
import { HybridCatalogSourceProvider } from "./catalog/HybridCatalogSourceProvider.js";
import { AuthorizedDriveCatalogProvider } from "./catalog/AuthorizedDriveCatalogProvider.js";
import { StructuredDriveCatalogProvider } from "./catalog/StructuredDriveCatalogProvider.js";
import { PublicDriveFolderReader } from "./catalog/PublicDriveFolderReader.js";
import { DriveCollectionService } from "./collections/DriveCollectionService.js";
import { ComicCoverThumbnailService } from "./collections/ComicCoverThumbnailService.js";
import { SupabaseCollectionIndexStore } from "./collections/SupabaseCollectionIndexStore.js";
import { DriveFolderBrowser } from "./collections/DriveFolderBrowser.js";
import { DriveRequestLimiter } from "./collections/DriveRequestLimiter.js";
import { UserPersistenceRepository } from "./repositories/UserPersistenceRepository.js";
import { OpdsController, isOpdsRequest, type OpdsCatalog } from "./opds/OpdsController.js";
import { OpdsCoverService } from "./opds/OpdsCoverService.js";
import { OpdsDownloadService } from "./opds/OpdsDownloadService.js";
import { OpdsAuth } from "./opds/OpdsAuth.js";
import { OpdsUserRepository } from "./opds/OpdsUserRepository.js";
import { SupabaseKindleEditions } from "./kindle/KindleEditions.js";
import type { CatalogSourceConfig } from "./catalog/types.js";

export type RequestHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

export const isPublicCatalogRequest = (method: string | undefined, path: string): boolean =>
  method === "GET" && /^\/api\/catalog\/books(?:\/[^/]+(?:\/download)?)?$/.test(path);

/** Published collections are public reading material, exactly like the catalogue: browsing
 * a folder must never ask the reader to sign in to Lumeo, let alone to Google. Reindex is
 * the one write here, and it is never a Lumeo account: it is public in the same sense
 * (no Bearer token expected), gated instead by its own shared secret inside the handler. */
export const isPublicCollectionRequest = (method: string | undefined, path: string): boolean =>
  (method === "GET" && /^\/api\/collections(?:\/[a-z0-9-]+\/(?:folders(?:\/[A-Za-z0-9_-]+)?|search-index|comic-cover\/[A-Za-z0-9_-]+))?$/i.test(path))
  || (method === "POST" && /^\/api\/collections\/[a-z0-9-]+\/reindex$/i.test(path));

// The OPDS catalog's source lives in its own module so the Kindle conversion worker reads the
// very same folder, with the very same book ids.
export { opdsAutoajudaSource } from "./opds/OpdsSources.js";
import { opdsAutoajudaSource } from "./opds/OpdsSources.js";

/**
 * The OPDS catalog over one structured Drive source. A single source lists its books but not the
 * genres (only the app's hybrid catalog builds that list), and the OPDS root is made of genres:
 * without them the reader saw an empty catalog. The source's own genre is its shelf.
 */
export const opdsSourceCatalog = (provider: Pick<StructuredDriveCatalogProvider, "list" | "get">, source: CatalogSourceConfig): OpdsCatalog => {
  const genres = source.genre ? [{ id: catalogGenreId(source.genre), name: source.genre }] : [];
  return {
    list: async (query) => ({ ...await provider.list(query), genres }),
    get: async (bookId) => {
      const book = await provider.get(bookId);
      if (!book) throw new ApiError(404, "CATALOG_BOOK_NOT_FOUND", "Livro não encontrado no catálogo.");
      return book;
    },
  };
};

export class ServerApp {
  public static create(config: ServerConfig = Config.fromEnvironment()): RequestHandler {
    let controller: ApiController | null = null;
    // OPDS has its own source list so the Kindle pilot cannot change what the app publishes.
    let opdsStore: OpdsUserRepository | null = null, opds: OpdsController | null = null;
    const getController = (): ApiController => {
      if (controller) return controller;
      if (config.localAuthMode) {
        const auth = new LocalAuthService();
        const localConfig = { ...config, autoActivateDevLicense: true };
        controller = new ApiController(auth, new AuthMiddleware(auth),
          new DeviceService(new MemoryDeviceRepository(), config.deviceHashSecret || "lumeo-local-only-device-secret"),
          new LicenseService(new MemoryLicenseRepository(), localConfig), new MemoryProfileRepository());
        return controller;
      }
      const supabase = new SupabaseService(config);
      const auth = new AuthService(supabase.auth);
      const createDrive = (folderId = config.googleCatalogFolderId) => new GoogleCatalogDriveClient(config.googleCatalogServiceAccountJson, folderId, config.catalogSyncMaxFileBytes);
      // Environment sources plus the genre folders saved in the admin screen.
      const sourceStore = new CatalogSourceRepository(supabase.admin);
      const metadataDrive = config.googleCatalogServiceAccountJson.trim() ? createDrive() : null;
      const discovery = metadataDrive && config.catalogDiscoveryRoots?.length
        ? new CatalogRootDiscovery(config.catalogDiscoveryRoots, metadataDrive)
        : undefined;
      const configuredSources = new ConfiguredCatalogSources(config.catalogSources, sourceStore, 60_000, discovery);
      // Public Drive HTML exposes only its initially rendered rows. When the server account is
      // configured, folders are read through the paginated Drive API instead: a structured
      // folder by its catalog.json, any other by listing its files.
      const catalogSources = new CatalogSourceRegistry(() => configuredSources.all(), config.googleCatalogServiceAccountJson.trim() ? {
        legacy: (source) => new AuthorizedDriveCatalogProvider(source, () => createDrive(source.folderId)),
        structured: (source) => new StructuredDriveCatalogProvider(source, new PublicDriveFolderReader(), fetch, { read: (folderId) => metadataDrive!.readCatalogJson(folderId) }),
      } : undefined);
      const catalogStore = new CatalogRepository(supabase.admin);
      // One client, reused for every folder listing and comic-cover read this instance ever
      // serves - not a new one per call. GoogleCatalogDriveClient caches its own OAuth token
      // across calls on the same instance, but only if the instance itself is reused; a
      // fresh createDrive() per call was paying for a full JWT-bearer exchange on every
      // single Drive request, which is what made a CBR's breadcrumb walk + download time out.
      const collectionsDrive = createDrive();
      // The Drive tree is the navigation: this only ever lists the folder that was asked for.
      // The materialized search index lives in Supabase Storage, not the database - no
      // migration needed, and it is metadata only, never a comic's own bytes.
      const collectionsService = new DriveCollectionService(config.driveCollections, new DriveFolderBrowser((url) => collectionsDrive.request(url), new DriveRequestLimiter()),
        {}, new SupabaseCollectionIndexStore(supabase.admin));
      // A CBR/CBZ cover is the one place a comic's own bytes are read server-side, and only
      // long enough to find its first page and discard the rest - reuses the exact same
      // service account already trusted to browse the collection's folders, and the exact
      // same open() validation collectionsService itself already enforces.
      const comicCovers = new ComicCoverThumbnailService(collectionsService, collectionsDrive);
      controller = new ApiController(
        auth,
        new AuthMiddleware(auth),
        new DeviceService(new DeviceRepository(supabase.admin), config.deviceHashSecret),
        new LicenseService(new LicenseRepository(supabase.admin), config),
        new ProfileRepository(supabase.admin),
        new CatalogApplicationService(catalogStore, () => createDrive(), new HybridCatalogSourceProvider((locale) => catalogSources.providers(locale))),
        new UserPersistenceRepository(supabase.admin),
        new CatalogSourceAdminService(sourceStore, configuredSources, catalogSources, (userId) => catalogStore.isAdmin(userId)),
        collectionsService,
        config.collectionReindexSecret,
        comicCovers,
      );
      return controller;
    };
    const getOpds = (): OpdsController => {
      if (opds) return opds;
      // OPDS uses the public structured Autoajuda folder directly. It does not initialize the
      // app catalog, comics collections or the private Drive service account.
      const database = new SupabaseService(config).admin;
      opdsStore = new OpdsUserRepository(database);
      const source = opdsAutoajudaSource(config);
      opds = new OpdsController(opdsSourceCatalog(new StructuredDriveCatalogProvider(source), source), new OpdsAuth(opdsStore), new OpdsCoverService(), new OpdsDownloadService(opdsStore, config.opdsDownloadsPerHour ?? 30),
        { locale: config.opdsCatalogLocale, requireHttps: config.nodeEnv === "production" }, new SupabaseKindleEditions(database));
      return opds;
    };
    const requestIds = new RequestId();
    const securityHeaders = new SecurityHeaders();
    const rateLimiter = new RateLimiter({
      "/api/auth/signup": { windowMs: 60_000, max: 5 },
      "/api/auth/login": { windowMs: 60_000, max: 8 },
      "/api/auth/google": { windowMs: 60_000, max: 8 },
      "/api/auth/refresh": { windowMs: 60_000, max: 20 },
      "/api/device/register": { windowMs: 60_000, max: 10 },
      "/api/device/replace": { windowMs: 60_000, max: 5 },
      "/api/me": { windowMs: 60_000, max: 60 },
      "/api/catalog/sync": { windowMs: 60_000, max: 2 },
      "/api/catalog/sources/test": { windowMs: 60_000, max: 10 },
    });

    return async (request, response) => {
      const requestId = requestIds.assign(request, response);
      securityHeaders.apply(response, config);
      if (!ServerApp.cors(request, response, config)) return;
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (request.method === "GET" && path === "/api/health") {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ status: "ok", version: config.appVersion, environment: config.appEnv, timestamp: new Date().toISOString() }));
        return;
      }
      if (request.method === "GET" && path === "/api/ready") {
        const checks = {
          hasSupabaseUrl: Boolean(config.supabaseUrl),
          hasPublishableKey: Boolean(config.supabasePublishableKey),
          hasSecretKey: Boolean(config.supabaseSecretKey),
          hasDeviceHashSecret: Boolean(config.deviceHashSecret),
        };
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ status: config.localAuthMode || Object.values(checks).every(Boolean) ? "ok" : "degraded", checks, version: config.appVersion, environment: config.appEnv, timestamp: new Date().toISOString() }));
        return;
      }
      // OPDS (KOReader): its own HTTP Basic login, checked by its controller; no app account.
      if (isOpdsRequest(path)) {
        try { await getOpds().handle(request, response, path, ServerApp.clientKey(request)); }
        catch (error) {
          // Supabase reports failures as plain objects ({ message, code }), not Error instances.
          const detail = error && typeof error === "object" ? error as { message?: unknown; code?: unknown } : {};
          console.error(JSON.stringify({ event: "OPDS_FAILED", requestId, reason: error instanceof Error ? error.message : String(detail.message ?? "unknown").slice(0, 300), code: typeof detail.code === "string" ? detail.code : undefined }));
          response.statusCode = error instanceof ApiError ? error.status : 503;
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.end(error instanceof ApiError ? error.message : "Catálogo indisponível no momento.");
        }
        return;
      }
      rateLimiter.assertAllowed(ServerApp.clientKey(request), path);
      const publicPaths = ["/api/auth/signup", "/api/auth/login", "/api/auth/google", "/api/auth/refresh"];
      const publicCatalog = isPublicCatalogRequest(request.method, path) || isPublicCollectionRequest(request.method, path);
      if (!publicPaths.includes(path) && !publicCatalog && !request.headers.authorization?.startsWith("Bearer ")) {
        response.statusCode = 401;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ ok: false, code: "AUTH_REQUIRED", message: "Autenticação necessária.", requestId }));
        return;
      }
      try { await getController().handle(request, response, path); }
      catch (error) {
        const message = error instanceof ApiError ? error.message : "Serviço indisponível.";
        response.statusCode = error instanceof ApiError ? error.status : 503;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ ok: false, code: error instanceof ApiError ? error.code : "CONFIGURATION_ERROR", message, requestId }));
      }
    };
  }

  private static cors(request: IncomingMessage, response: ServerResponse, config: ServerConfig): boolean {
    const origin = request.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Installation-Id");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      // A cross-origin fetch() (Capacitor's https://localhost origin) can read the response
      // body without this, but not these headers - browsers only expose the CORS safelist by
      // default, which excludes ETag and any custom X- header.
      response.setHeader("Access-Control-Expose-Headers", "ETag, X-Comic-Title, X-Comic-Series, X-Comic-Number, X-Comic-Year, X-Comic-Writer, X-Comic-Publisher, X-Comic-Genre, X-Comic-Summary");
    }
    if (request.method === "OPTIONS") {
      response.statusCode = origin && !config.allowedOrigins.includes(origin) ? 403 : 204;
      response.end();
      return false;
    }
    return true;
  }

  private static clientKey(request: IncomingMessage): string {
    const forwarded = request.headers["x-forwarded-for"];
    return (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : request.socket.remoteAddress) || "unknown";
  }
}
