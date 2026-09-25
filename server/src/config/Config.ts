import { ApiError } from "../errors/ApiError.js";
import { catalogSourcesFromEnvironment } from "../catalog/CatalogSourceRegistry.js";
import { driveCollectionsFromEnvironment } from "../collections/DriveCollectionRegistry.js";
import type { CatalogSourceConfig } from "../catalog/types.js";
import type { DriveCollection } from "../collections/types.js";

export interface ServerConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseSecretKey: string;
  deviceHashSecret: string;
  autoActivateDevLicense: boolean;
  nodeEnv: string;
  appEnv: string;
  appVersion: string;
  appBaseUrl: string;
  bffBaseUrl: string;
  port: number;
  allowedOrigins: readonly string[];
  localAuthMode: boolean;
  googleCatalogFolderId: string;
  catalogSources: readonly CatalogSourceConfig[];
  catalogDiscoveryRoots?: readonly string[];
  googleCatalogServiceAccountJson: string;
  catalogSyncMaxFileBytes: number;
  /** Published Drive folders browsed live, folder by folder. */
  driveCollections: readonly DriveCollection[];
}

export class Config {
  public static fromEnvironment(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
    const nodeEnv = environment.NODE_ENV ?? "development";
    const googleCatalogFolderId = environment.GOOGLE_CATALOG_FOLDER_ID ?? "1JUbxHjUzyYruG9LWyz1HRYv9matGU7ad";
    const discoveryRoots = environment.GOOGLE_CATALOG_DISCOVERY_ROOTS?.trim()
      || "1bMwUwTOKGrcZfKyEgL-yyS69Xk1CxFYe,1E66iTORF03TJ6hPMi5jjwwK2pvZReDmx";
    const configuredOrigins = environment.ALLOWED_ORIGINS
      ?? (nodeEnv === "production" ? environment.APP_BASE_URL ?? "" : "http://localhost:5173,http://127.0.0.1:5173");
    // Capacitor Android serves the packaged frontend at this secure local
    // origin. It is not a loopback BFF URL: requests still target the public
    // BFF and use bearer authentication. Keeping this explicit avoids an
    // Android-only CORS failure when ALLOWED_ORIGINS is configured for web.
    const allowedOrigins = [...configuredOrigins.split(","), ...(nodeEnv === "production" ? ["https://localhost"] : [])]
      .map((origin) => origin.trim()).filter(Boolean);
    return {
      supabaseUrl: environment.SUPABASE_URL ?? "",
      supabasePublishableKey: environment.SUPABASE_PUBLISHABLE_KEY ?? environment.SUPABASE_ANON_KEY ?? "",
      supabaseSecretKey: environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY ?? "",
      deviceHashSecret: environment.DEVICE_HASH_SECRET ?? "",
      // This is intentionally opt-in. It may be enabled in a temporary test
      // deployment, including Vercel Production, but is never inferred from
      // NODE_ENV and must be turned off before paid licensing is enabled.
      autoActivateDevLicense: environment.AUTO_ACTIVATE_DEV_LICENSE === "true",
      nodeEnv,
      appEnv: environment.APP_ENV ?? nodeEnv,
      appVersion: environment.APP_VERSION ?? "0.1.0",
      appBaseUrl: environment.APP_BASE_URL ?? "http://localhost:5173",
      bffBaseUrl: environment.BFF_BASE_URL ?? "http://127.0.0.1:3000/api",
      port: Number(environment.PORT ?? 3000),
      allowedOrigins: [...new Set(allowedOrigins)],
      localAuthMode: nodeEnv !== "production" && environment.LOCAL_AUTH_MODE !== "false"
        && !environment.SUPABASE_URL,
      // Public pt-BR catalogue. The environment variable is the production
      // override; the default keeps this published public source usable locally.
      googleCatalogFolderId,
      // Public metadata only. The fallback preserves the published legacy source.
      catalogSources: catalogSourcesFromEnvironment(environment.GOOGLE_CATALOG_SOURCES_JSON, googleCatalogFolderId),
      // Roots already published by the two catalogue Drives. The backend discovers genre
      // folders from their actual contents; no genre list is maintained in the frontend.
      catalogDiscoveryRoots: [...new Set(discoveryRoots.split(",").map((id) => id.trim()).filter((id) => /^[A-Za-z0-9_-]{10,}$/.test(id)))],
      // JSON or base64 JSON are accepted only in backend environment variables.
      googleCatalogServiceAccountJson: environment.GOOGLE_CATALOG_SERVICE_ACCOUNT_JSON ?? "",
      catalogSyncMaxFileBytes: Number(environment.CATALOG_SYNC_MAX_FILE_BYTES ?? 104_857_600),
      driveCollections: driveCollectionsFromEnvironment(environment.DRIVE_COLLECTIONS_JSON),
    };
  }

  public static assertSupabase(config: ServerConfig): void {
    if (!config.supabaseUrl || !config.supabasePublishableKey || !config.supabaseSecretKey) {
      throw new ApiError(503, "SUPABASE_NOT_CONFIGURED", "Supabase não configurado no backend.");
    }
  }
}
