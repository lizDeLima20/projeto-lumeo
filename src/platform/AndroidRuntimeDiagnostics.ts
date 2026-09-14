import { Capacitor } from "@capacitor/core";
import type { FrontendEnvironmentConfig } from "../config/EnvironmentConfig";

/** Native-only diagnostics. URLs are reduced to origin + pathname; no session or key is logged. */
export class AndroidRuntimeDiagnostics {
  public static start(config: FrontendEnvironmentConfig): void {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;
    console.info("LUMEO_ANDROID_RUNTIME", JSON.stringify({
      apiBaseUrl: this.safeUrl(config.bffBaseUrl),
      supabaseUrl: this.safeUrl(config.supabaseUrl),
      origin: this.safeUrl(globalThis.location?.origin ?? ""),
      callback: "com.lumeo.reader://auth/callback",
      packageName: "com.lumeo.reader",
      googleClientConfigured: Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()),
    }));
    void this.probeReady(config.bffBaseUrl);
  }

  private static async probeReady(baseUrl: string): Promise<void> {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/ready`, { headers: { Accept: "application/json" } });
      console.info("LUMEO_ANDROID_BFF_READY", JSON.stringify({ host: this.safeUrl(baseUrl), status: response.status, ok: response.ok }));
    } catch {
      console.warn("LUMEO_ANDROID_BFF_READY", JSON.stringify({ host: this.safeUrl(baseUrl), status: "network-or-cors-error", ok: false }));
    }
  }

  private static safeUrl(value: string): string | null {
    try { const url = new URL(value); return `${url.origin}${url.pathname}`; }
    catch { return value.startsWith("/") ? value : null; }
  }
}
