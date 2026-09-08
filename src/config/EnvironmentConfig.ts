export type FrontendEnvironment = "development" | "test" | "production";

export interface FrontendEnvironmentConfig {
  appEnv: FrontendEnvironment;
  appVersion: string;
  appBaseUrl: string;
  bffBaseUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export class EnvironmentConfig {
  public constructor(private readonly env: ImportMetaEnv = import.meta.env) {}

  public read(): FrontendEnvironmentConfig {
    return {
      appEnv: this.normalize(this.env.VITE_APP_ENV ?? this.env.MODE),
      appVersion: this.env.VITE_APP_VERSION ?? "0.1.0",
      appBaseUrl: this.env.VITE_APP_BASE_URL ?? globalThis.location?.origin ?? "",
      bffBaseUrl: this.env.VITE_API_URL ?? "/api",
      supabaseUrl: this.env.VITE_SUPABASE_URL ?? "",
      supabasePublishableKey: this.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? this.env.VITE_SUPABASE_ANON_KEY ?? "",
    };
  }

  public assertNoFrontendSecrets(keys: readonly string[] = Object.keys(this.env)): boolean {
    return keys.every((key) => !/(SERVICE_ROLE|ROLE_KEY|DEVICE_HASH_SECRET|HMAC|PRIVATE_KEY|PAYMENT_SECRET|SECRET_KEY|SECRET)$/i.test(key));
  }

  public assertNoSecretValues(values: readonly string[]): boolean {
    return values.every((value) => !/^sb_secret_/i.test(value));
  }

  private normalize(value?: string): FrontendEnvironment {
    if (value === "production" || value === "test") return value;
    return "development";
  }
}
