import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import { ApiController } from "../src/controllers/ApiController.js";
import { AuthMiddleware } from "../src/middleware/requireAuth.js";
import type { ProfileStore } from "../src/repositories/ProfileRepository.js";
import type { AuthProvider } from "../src/services/AuthService.js";
import { DeviceService } from "../src/services/DeviceService.js";
import { LicenseService } from "../src/services/LicenseService.js";
import { MemoryDeviceRepository, MemoryLicenseRepository } from "../src/repositories/MemoryRepositories.js";
import type { ApiResponse, AuthenticatedRequest } from "../src/types/http.js";

describe("ApiController auth flow", () => {
  it("loginReturnsSchemaNotReadyWhenProfileTableIsMissing", async () => {
    const auth = {
      login: async () => ({
        accessToken: "access-token-value",
        refreshToken: "refresh-token-value",
        expiresAt: 1,
        user: { id: "00000000-0000-4000-8000-000000000000", email: "user@example.com" },
      }),
      signup: async () => { throw new Error("not used"); },
      refresh: async () => { throw new Error("not used"); },
      verify: async () => { throw new Error("not used"); },
      requireRecentAuthentication: () => undefined,
    } satisfies AuthProvider;
    const profiles = {
      ensure: async () => {
        throw { code: "PGRST205", message: "Could not find the table 'public.profiles' in the schema cache" };
      },
    } satisfies ProfileStore;
    const response = new TestResponse();
    const request = Readable.from([JSON.stringify({ email: "user@example.com", password: "password123" })]) as AuthenticatedRequest;
    request.method = "POST";
    request.headers = {};
    const controller = new ApiController(
      auth,
      new AuthMiddleware(auth),
      new DeviceService(new MemoryDeviceRepository(), "device-secret"),
      new LicenseService(new MemoryLicenseRepository(), {
        autoActivateDevLicense: false,
        supabaseUrl: "",
        supabasePublishableKey: "",
        supabaseSecretKey: "",
        deviceHashSecret: "device-secret",
        nodeEnv: "test",
        appEnv: "test",
        appVersion: "0.1.0",
        appBaseUrl: "http://localhost:5173",
        bffBaseUrl: "http://127.0.0.1:3000/api",
        port: 3000,
        allowedOrigins: [],
        localAuthMode: false,
      }),
      profiles,
    );

    await controller.handle(request, response as never as ApiResponse, "/api/auth/login");

    assert.equal(response.statusCode, 503);
    assert.equal(JSON.parse(response.body).code, "DATABASE_SCHEMA_NOT_READY");
  });
});

class TestResponse {
  public statusCode = 200;
  public body = "";
  private readonly headers = new Map<string, unknown>();

  public setHeader(name: string, value: unknown): void {
    this.headers.set(name, value);
  }

  public getHeader(name: string): unknown {
    return this.headers.get(name);
  }

  public end(body: string): void {
    this.body = body;
  }
}
