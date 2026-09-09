import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import { VercelRequestAdapter } from "../src/VercelRequestAdapter.js";
import { ApiController } from "../src/controllers/ApiController.js";
import { ApiError } from "../src/errors/ApiError.js";
import { AuthMiddleware } from "../src/middleware/requireAuth.js";
import { DeviceService } from "../src/services/DeviceService.js";
import { LicenseService } from "../src/services/LicenseService.js";
import { MemoryDeviceRepository, MemoryLicenseRepository, MemoryProfileRepository } from "../src/repositories/MemoryRepositories.js";
import { Config } from "../src/config/Config.js";
import type { AuthProvider } from "../src/services/AuthService.js";
import type { AuthenticatedRequest, ApiResponse } from "../src/types/http.js";

describe("Vercel BFF routing", () => {
  for (const action of ["login", "signup"] as const) {
    for (const parsed of [true, false]) {
      it(`${action} reaches the auth provider with ${parsed ? "parsed Vercel" : "Node stream"} JSON`, async () => {
        const input = { email: "test@example.com", password: "test-password-123" };
        const request = Readable.from(parsed ? [] : [JSON.stringify(input)]) as AuthenticatedRequest;
        request.method = "POST";
        request.headers = {};
        request.url = `/api/index?__lumeo_route=auth/${action}`;
        if (parsed) request.body = input;
        VercelRequestAdapter.restorePath(request);
        assert.equal(request.url, `/api/auth/${action}`);
        let reached = false;
        const authenticate = async (email: string, password: string): Promise<never> => {
          assert.deepEqual({ email, password }, input);
          reached = true;
          throw new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Credenciais inválidas.");
        };
        const auth: AuthProvider = {
          login: authenticate, signup: authenticate,
          refresh: async () => { throw new Error("unused"); },
          verify: async () => { throw new Error("unused"); },
          requireRecentAuthentication: () => undefined,
        };
        const controller = new ApiController(auth, new AuthMiddleware(auth),
          new DeviceService(new MemoryDeviceRepository(), "test-secret"),
          new LicenseService(new MemoryLicenseRepository(), Config.fromEnvironment({ NODE_ENV: "test" })),
          new MemoryProfileRepository());
        let body = "";
        const response = { statusCode: 200, setHeader: () => undefined, getHeader: () => undefined,
          end: (value: string) => { body = value; } };
        await controller.handle(request, response as unknown as ApiResponse, request.url!);
        assert.equal(reached, true);
        assert.equal(response.statusCode, 401);
        assert.equal(JSON.parse(body).code, "AUTH_INVALID_CREDENTIALS");
      });
    }
  }
  it("preserves original paths when the platform keeps them", () => {
    const request = { url: "/api/auth/login?__lumeo_route=auth/login" } as AuthenticatedRequest;
    VercelRequestAdapter.restorePath(request);
    assert.equal(new URL(request.url!, "https://example.com").pathname, "/api/auth/login");
  });
  it("restores readiness and preserves other query parameters", () => {
    const request = { url: "/api/index?__lumeo_route=ready&check=1" } as AuthenticatedRequest;
    VercelRequestAdapter.restorePath(request);
    assert.equal(request.url, "/api/ready?check=1");
  });
});
