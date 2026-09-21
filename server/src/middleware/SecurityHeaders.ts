import type { ServerResponse } from "node:http";
import type { ServerConfig } from "../config/Config.js";

export class SecurityHeaders {
  public apply(response: ServerResponse, config: ServerConfig): void {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    response.setHeader("Content-Security-Policy", this.csp(config));
    if (config.nodeEnv === "production") response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }

  private csp(config: ServerConfig): string {
    const origins = config.allowedOrigins.join(" ");
    return [
      "default-src 'self'",
      `connect-src 'self' ${origins} ${config.supabaseUrl}`.trim(),
      "img-src 'self' blob: data:",
      "worker-src 'self' blob:",
      // The comic reader runs Tesseract locally as WebAssembly. Chrome checks wasm
      // compilation against script-src, so without this the engine cannot start. It permits
      // wasm only - it is not 'unsafe-eval' and does not re-open JavaScript eval.
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
  }
}
