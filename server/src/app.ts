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
import { CatalogSourceRepository } from "./catalog/CatalogSourceRepository.js";
import { ConfiguredCatalogSources } from "./catalog/CatalogGenreSources.js";
import { CatalogSourceAdminService } from "./catalog/CatalogSourceAdminService.js";
import { HybridCatalogSourceProvider } from "./catalog/HybridCatalogSourceProvider.js";
import { AuthorizedDriveCatalogProvider } from "./catalog/AuthorizedDriveCatalogProvider.js";
import { StructuredDriveCatalogProvider } from "./catalog/StructuredDriveCatalogProvider.js";
import { PublicDriveFolderReader } from "./catalog/PublicDriveFolderReader.js";
import { UserPersistenceRepository } from "./repositories/UserPersistenceRepository.js";

export type RequestHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

export const isPublicCatalogRequest = (method: string | undefined, path: string): boolean =>
  method === "GET" && /^\/api\/catalog\/books(?:\/[^/]+(?:\/download)?)?$/.test(path);

export class ServerApp {
  public static create(config: ServerConfig = Config.fromEnvironment()): RequestHandler {
    let controller: ApiController | null = null;
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
      const configuredSources = new ConfiguredCatalogSources(config.catalogSources, sourceStore);
      // Public Drive HTML exposes only its initially rendered rows. When the server account is
      // configured, folders are read through the paginated Drive API instead: a structured
      // folder by its catalog.json, any other by listing its files.
      const catalogSources = new CatalogSourceRegistry(() => configuredSources.all(), config.googleCatalogServiceAccountJson.trim() ? {
        legacy: (source) => new AuthorizedDriveCatalogProvider(source, () => createDrive(source.folderId)),
        structured: (source) => new StructuredDriveCatalogProvider(source, new PublicDriveFolderReader(), fetch, { read: (folderId) => createDrive(folderId).readCatalogJson() }),
      } : undefined);
      const catalogStore = new CatalogRepository(supabase.admin);
      controller = new ApiController(
        auth,
        new AuthMiddleware(auth),
        new DeviceService(new DeviceRepository(supabase.admin), config.deviceHashSecret),
        new LicenseService(new LicenseRepository(supabase.admin), config),
        new ProfileRepository(supabase.admin),
        new CatalogApplicationService(catalogStore, () => createDrive(), new HybridCatalogSourceProvider((locale) => catalogSources.providers(locale))),
        new UserPersistenceRepository(supabase.admin),
        new CatalogSourceAdminService(sourceStore, configuredSources, catalogSources, (userId) => catalogStore.isAdmin(userId)),
      );
      return controller;
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
      rateLimiter.assertAllowed(ServerApp.clientKey(request), path);
      const publicPaths = ["/api/auth/signup", "/api/auth/login", "/api/auth/google", "/api/auth/refresh"];
      const publicCatalog = isPublicCatalogRequest(request.method, path);
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
