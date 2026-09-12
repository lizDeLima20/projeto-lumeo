import { ApiError } from "../errors/ApiError.js";
import { catalogSourcesFromEnvironment } from "../catalog/CatalogSourceRegistry.js";
import type { CatalogSourceConfig } from "../catalog/types.js";

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
  googleCatalogServiceAccountJson: string;
  catalogSyncMaxFileBytes: number;
}

export class Config {
  public static fromEnvironment(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
    const nodeEnv = environment.NODE_ENV ?? "development";
    const googleCatalogFolderId = environment.GOOGLE_CATALOG_FOLDER_ID ?? "1JUbxHjUzyYruG9LWyz1HRYv9matGU7ad";
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
      allowedOrigins: (environment.ALLOWED_ORIGINS ?? (nodeEnv === "production" ? environment.APP_BASE_URL ?? "" : "http://localhost:5173,http://127.0.0.1:5173"))
        .split(",").map((origin) => origin.trim()).filter(Boolean),
      localAuthMode: nodeEnv !== "production" && environment.LOCAL_AUTH_MODE !== "false"
        && !environment.SUPABASE_URL,
      // Public pt-BR catalogue. The environment variable is the production
      // override; the default keeps this published public source usable locally.
      googleCatalogFolderId,
      // Public metadata only. The fallback preserves the published legacy source.
      catalogSources: catalogSourcesFromEnvironment(environment.GOOGLE_CATALOG_SOURCES_JSON, googleCatalogFolderId),
      // JSON or base64 JSON are accepted only in backend environment variables.
      googleCatalogServiceAccountJson: environment.GOOGLE_CATALOG_SERVICE_ACCOUNT_JSON ?? "",
      catalogSyncMaxFileBytes: Number(environment.CATALOG_SYNC_MAX_FILE_BYTES ?? 104_857_600),
    };
  }

  public static assertSupabase(config: ServerConfig): void {
    if (!config.supabaseUrl || !config.supabasePublishableKey || !config.supabaseSecretKey) {
      throw new ApiError(503, "SUPABASE_NOT_CONFIGURED", "Supabase não configurado no backend.");
    }
  }
}
