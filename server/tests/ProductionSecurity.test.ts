import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { EnvironmentConfig } from "../src/config/EnvironmentConfig.js";
import { EnvFileLoader } from "../src/config/EnvFileLoader.js";
import { Config } from "../src/config/Config.js";
import { ApiError } from "../src/errors/ApiError.js";
import { RateLimiter } from "../src/middleware/RateLimiter.js";
import { RequestId } from "../src/middleware/RequestId.js";
import { PaymentWebhookHandler } from "../src/payments/PaymentWebhookHandler.js";
import { RequestValidator } from "../src/validation/RequestValidator.js";
import { StructuredLogger } from "../src/logging/StructuredLogger.js";
import { DeviceService } from "../src/services/DeviceService.js";

describe("produção e segurança do BFF", () => {
  it("serviceRoleKeyIsServerOnly", () => {
    const config = new EnvironmentConfig({ SUPABASE_SECRET_KEY: "sb_secret_server", APP_ENV: "production" }).read();
    assert.equal(config.supabaseSecretKey, "sb_secret_server");
    assert.equal("supabaseSecretKey" in new EnvironmentConfig({ SUPABASE_SECRET_KEY: "sb_secret_server" }).frontendSafe(), false);
  });

  it("legacySupabaseKeysRemainFallbackOnly", () => {
    const config = new EnvironmentConfig({ SUPABASE_ANON_KEY: "legacy-anon", SUPABASE_SERVICE_ROLE_KEY: "legacy-service" }).read();
    assert.equal(config.supabasePublishableKey, "legacy-anon");
    assert.equal(config.supabaseSecretKey, "legacy-service");
  });

  it("runtimeConfigPresenceUsesOnlyBooleans", () => {
    assert.deepEqual(EnvFileLoader.presence({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public",
      SUPABASE_SECRET_KEY: "sb_secret_server",
      DEVICE_HASH_SECRET: "device-secret",
    }), {
      hasSupabaseUrl: true,
      hasPublishableKey: true,
      hasSecretKey: true,
      hasDeviceHashSecret: true,
    });
  });

  it("allows Capacitor Android's secure WebView origin in production", () => {
    const config = Config.fromEnvironment({ NODE_ENV: "production", APP_BASE_URL: "https://lumeo-livros.vercel.app", ALLOWED_ORIGINS: "https://lumeo-livros.vercel.app" });
    assert.deepEqual(config.allowedOrigins, ["https://lumeo-livros.vercel.app", "https://localhost"]);
  });

  it("missingSupabaseConfigUsesSafeInternalCode", () => {
    assert.throws(
      () => Config.assertSupabase({ ...Config.fromEnvironment({}), localAuthMode: false }),
      (error) => error instanceof ApiError && error.code === "SUPABASE_NOT_CONFIGURED",
    );
  });

  it("missingDeviceHashUsesSafeInternalCode", async () => {
    const devices = new DeviceService({
      findByHash: async () => null,
      findActiveByUser: async () => null,
      create: async () => { throw new Error("not used"); },
      replaceActive: async () => { throw new Error("not used"); },
      revokeActive: async () => undefined,
      countActive: async () => 0,
      touch: async () => undefined,
    }, "");
    await assert.rejects(
      () => devices.getState("user-1", "00000000-0000-4000-8000-000000000000"),
      (error) => error instanceof ApiError && error.code === "DEVICE_HASH_NOT_CONFIGURED",
    );
  });

  it("rateLimitsSensitiveEndpoints", () => {
    const limiter = new RateLimiter({ "/api/auth/login": { windowMs: 60_000, max: 1 } }, () => 1);
    limiter.assertAllowed("ip", "/api/auth/login");
    assert.throws(() => limiter.assertAllowed("ip", "/api/auth/login"), /Muitas tentativas/);
  });

  it("requestHasRequestId", () => {
    const headers = new Map<string, unknown>();
    const id = new RequestId().assign({ headers: {} } as never, { setHeader: (key: string, value: unknown) => headers.set(key, value) } as never);
    assert.equal(headers.get("X-Request-Id"), id);
  });

  it("invalidBodyIsRejected", () => {
    assert.throws(() => new RequestValidator().email("not-email"), (error) => error instanceof ApiError && error.code === "INVALID_EMAIL");
    assert.throws(() => new RequestValidator().deviceName(""), (error) => error instanceof ApiError && error.code === "INVALID_DEVICE_NAME");
  });

  it("duplicateWebhookIsIdempotent", () => {
    const handler = new PaymentWebhookHandler("secret");
    assert.equal(handler.process({ id: "evt-1", timestamp: Date.now(), type: "license.paid", payload: {} }), "processed");
    assert.equal(handler.process({ id: "evt-1", timestamp: Date.now(), type: "license.paid", payload: {} }), "duplicate");
  });

  it("webhookSignatureIsRequired", () => {
    const raw = JSON.stringify({ id: "evt-1" }), signature = createHmac("sha256", "secret").update(raw).digest("hex");
    assert.doesNotThrow(() => new PaymentWebhookHandler("secret").verify(raw, signature));
    assert.throws(() => new PaymentWebhookHandler("secret").verify(raw, "00"), /Assinatura inválida/);
  });

  it("logsDoNotExposePrivateReaderData", () => {
    const sanitized = new StructuredLogger("production").sanitize({ token: "a", note: "private", requestId: "r" });
    assert.deepEqual(sanitized, { requestId: "r" });
  });
});
