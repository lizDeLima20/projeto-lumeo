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
import { isPublicCatalogRequest } from "../src/app.js";

describe("public catalogue authentication boundary", () => {
  it("allows only public catalogue reads through the outer BFF gate", () => {
    assert.equal(isPublicCatalogRequest("GET", "/api/catalog/books"), true);
    assert.equal(isPublicCatalogRequest("GET", "/api/catalog/books/source%3Abook"), true);
    assert.equal(isPublicCatalogRequest("GET", "/api/catalog/books/source%3Abook/download"), true);
    assert.equal(isPublicCatalogRequest("POST", "/api/catalog/books"), false);
    assert.equal(isPublicCatalogRequest("GET", "/api/catalog/sources"), false);
    assert.equal(isPublicCatalogRequest("GET", "/api/catalog/admin/status"), false);
  });
});

describe("ApiController auth flow", () => {
  it("serves public catalogue metadata and download links without opening private routes", async () => {
    let verifyCalls = 0;
    const auth = {
      login: async () => { throw new Error("unused"); }, signup: async () => { throw new Error("unused"); }, refresh: async () => { throw new Error("unused"); }, google: async () => { throw new Error("unused"); },
      verify: async () => { verifyCalls++; throw new Error("catalogue must stay public"); }, requireRecentAuthentication: () => undefined,
    } satisfies AuthProvider;
    const config = { autoActivateDevLicense: false, supabaseUrl: "", supabasePublishableKey: "", supabaseSecretKey: "", deviceHashSecret: "device-secret", nodeEnv: "test", appEnv: "test", appVersion: "0.1.0", appBaseUrl: "http://localhost:5173", bffBaseUrl: "http://127.0.0.1:3000/api", port: 3000, allowedOrigins: [], localAuthMode: false };
    const controller = new ApiController(auth, new AuthMiddleware(auth), new DeviceService(new MemoryDeviceRepository(), "device-secret"), new LicenseService(new MemoryLicenseRepository(), config), { ensure: async () => undefined } as ProfileStore,
      { list: async () => ({ items: [], nextCursor: null }), get: async () => ({ bookId: "source:book" }), download: async () => ({ bookId: "source:book", downloadUrl: "https://drive.google.com/file" }) } as never);
    for (const path of ["/api/catalog/books", "/api/catalog/books/source%3Abook", "/api/catalog/books/source%3Abook/download"]) {
      const request = Readable.from([]) as AuthenticatedRequest; request.method = "GET"; request.headers = {};
      const response = new TestResponse();
      await controller.handle(request, response as never as ApiResponse, path);
      assert.equal(response.statusCode, 200, path);
    }
    assert.equal(verifyCalls, 0);
    const privateRequest = Readable.from([]) as AuthenticatedRequest; privateRequest.method = "GET"; privateRequest.headers = {};
    const privateResponse = new TestResponse();
    await controller.handle(privateRequest, privateResponse as never as ApiResponse, "/api/catalog/admin/status");
    assert.equal(verifyCalls, 0);
    assert.equal(privateResponse.statusCode, 401);
  });

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
      google: async () => { throw new Error("not used"); },
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

describe("ApiController com Google", () => {
  const config = { autoActivateDevLicense: false, supabaseUrl: "", supabasePublishableKey: "", supabaseSecretKey: "", deviceHashSecret: "device-secret",
    nodeEnv: "test", appEnv: "test", appVersion: "0.1.0", appBaseUrl: "http://localhost:5173", bffBaseUrl: "http://127.0.0.1:3000/api", port: 3000, allowedOrigins: [], localAuthMode: false };
  const call = async (body: unknown, auth: AuthProvider, ensured: string[]) => {
    const profiles = { ensure: async (id: string, email: string) => { ensured.push(`${id}:${email}`); } } as unknown as ProfileStore;
    const controller = new ApiController(auth, new AuthMiddleware(auth), new DeviceService(new MemoryDeviceRepository(), "device-secret"),
      new LicenseService(new MemoryLicenseRepository(), config), profiles);
    const request = Readable.from([JSON.stringify(body)]) as AuthenticatedRequest; request.method = "POST"; request.headers = {};
    const response = new TestResponse();
    await controller.handle(request, response as never as ApiResponse, "/api/auth/google");
    return response;
  };
  const provider = (received: unknown[]): AuthProvider => ({
    google: async (token: string, nonce: string) => { received.push({ token, nonce });
      return { accessToken: "access-token-value", refreshToken: "refresh-token-value", expiresAt: 1, user: { id: "00000000-0000-4000-8000-000000000002", email: "leitor@gmail.com" } }; },
    login: async () => { throw new Error("not used"); }, signup: async () => { throw new Error("not used"); },
    refresh: async () => { throw new Error("not used"); }, verify: async () => { throw new Error("not used"); }, requireRecentAuthentication: () => undefined,
  });

  it("entra com o token do Google e prepara o perfil como no login", async () => {
    const received: unknown[] = [], ensured: string[] = [];
    const response = await call({ credential: "google-id-token-0123456789", nonce: "raw-nonce-value-0000" }, provider(received), ensured);
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).user.email, "leitor@gmail.com");
    assert.deepEqual(received, [{ token: "google-id-token-0123456789", nonce: "raw-nonce-value-0000" }]);
    assert.deepEqual(ensured, ["00000000-0000-4000-8000-000000000002:leitor@gmail.com"]);
  });

  it("recusa pedido sem nonce valido antes de falar com o Supabase", async () => {
    const received: unknown[] = [];
    const response = await call({ credential: "google-id-token-0123456789", nonce: "curto" }, provider(received), []);
    assert.equal(response.statusCode, 400);
    assert.equal(JSON.parse(response.body).code, "INVALID_NONCE");
    assert.equal(received.length, 0);
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
