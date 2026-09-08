import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface RuntimeSecretPresence {
  hasSupabaseUrl: boolean;
  hasPublishableKey: boolean;
  hasSecretKey: boolean;
  hasDeviceHashSecret: boolean;
}

export class EnvFileLoader {
  public static loadProjectEnv(moduleUrl: string, environment: NodeJS.ProcessEnv = process.env): boolean {
    if (environment.LUMEO_ENV_FILE_LOADED === "true") return true;
    for (const candidate of this.candidates(moduleUrl)) {
      if (!existsSync(candidate)) continue;
      process.loadEnvFile(candidate);
      environment.LUMEO_ENV_FILE_LOADED = "true";
      return true;
    }
    return false;
  }

  public static presence(environment: NodeJS.ProcessEnv = process.env): RuntimeSecretPresence {
    return {
      hasSupabaseUrl: Boolean(environment.SUPABASE_URL),
      hasPublishableKey: Boolean(environment.SUPABASE_PUBLISHABLE_KEY ?? environment.SUPABASE_ANON_KEY),
      hasSecretKey: Boolean(environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY),
      hasDeviceHashSecret: Boolean(environment.DEVICE_HASH_SECRET),
    };
  }

  private static candidates(moduleUrl: string): readonly string[] {
    const moduleDirectory = dirname(fileURLToPath(moduleUrl));
    return Array.from(new Set([
      resolve(process.cwd(), ".env"),
      resolve(process.cwd(), "../.env"),
      resolve(moduleDirectory, "../../.env"),
      resolve(moduleDirectory, "../.env"),
    ]));
  }
}
