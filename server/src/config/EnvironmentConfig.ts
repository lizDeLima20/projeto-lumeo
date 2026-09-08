export type AppEnvironment = "development" | "test" | "production";

export interface EnvironmentConfigData {
  appEnv: AppEnvironment;
  appVersion: string;
  appBaseUrl: string;
  bffBaseUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseSecretKey: string;
}

export class EnvironmentConfig {
  public constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  public read(): EnvironmentConfigData {
    const appEnv = this.environment.APP_ENV ?? this.environment.NODE_ENV ?? "development";
    return {
      appEnv: this.normalize(appEnv),
      appVersion: this.environment.APP_VERSION ?? "0.1.0",
      appBaseUrl: this.environment.APP_BASE_URL ?? "http://localhost:5173",
      bffBaseUrl: this.environment.BFF_BASE_URL ?? "http://127.0.0.1:3000/api",
      supabaseUrl: this.environment.SUPABASE_URL ?? "",
      supabasePublishableKey: this.environment.SUPABASE_PUBLISHABLE_KEY ?? this.environment.SUPABASE_ANON_KEY ?? "",
      supabaseSecretKey: this.environment.SUPABASE_SECRET_KEY ?? this.environment.SUPABASE_SERVICE_ROLE_KEY ?? "",
    };
  }

  public frontendSafe(): Omit<EnvironmentConfigData, "supabaseSecretKey"> {
    const { supabaseSecretKey: _secret, ...safe } = this.read();
    return safe;
  }

  private normalize(value: string): AppEnvironment {
    if (value === "production" || value === "test") return value;
    return "development";
  }
}
