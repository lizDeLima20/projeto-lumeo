import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "../src/errors/ApiError.js";
import { AuthMiddleware } from "../src/middleware/requireAuth.js";
import { AuthService } from "../src/services/AuthService.js";
import type { AuthenticatedRequest } from "../src/types/http.js";

describe("AuthMiddleware", () => {
  it("rejects a protected request without token", async () => {
    const auth = { verify: async () => ({ id: "unused", email: "unused@example.com" }) } as AuthService;
    const middleware = new AuthMiddleware(auth);
    await assert.rejects(() => middleware.requireAuth({ headers: {} } as AuthenticatedRequest),
      (error: unknown) => error instanceof ApiError && error.code === "AUTH_REQUIRED");
  });

  it("rejects an invalid token", async () => {
    const auth = { verify: async () => { throw new ApiError(401, "INVALID_TOKEN", "Token inválido."); } } as unknown as AuthService;
    const middleware = new AuthMiddleware(auth);
    const request = { headers: { authorization: "Bearer invalid" } } as AuthenticatedRequest;
    await assert.rejects(() => middleware.requireAuth(request),
      (error: unknown) => error instanceof ApiError && error.code === "INVALID_TOKEN");
  });
});

describe("AuthService", () => {
  it("signupUsesSpecificSupabaseEmailError", async () => {
    const auth = new AuthService(authClientWithSignupError({ code: "email_address_invalid", message: "Email address is invalid", status: 400 }));
    await assert.rejects(() => auth.signup("user@example.com", "password"),
      (error: unknown) => error instanceof ApiError && error.status === 400 && error.code === "AUTH_SIGNUP_EMAIL_REJECTED" && /Email address is invalid/.test(error.message));
  });

  it("signupRateLimitKeepsSupabaseStatus", async () => {
    const auth = new AuthService(authClientWithSignupError({ code: "over_email_send_rate_limit", message: "email rate limit exceeded", status: 429 }));
    await assert.rejects(() => auth.signup("user@example.com", "password"),
      (error: unknown) => error instanceof ApiError && error.status === 429 && error.code === "AUTH_RATE_LIMITED" && /email rate limit exceeded/.test(error.message));
  });

  it("invalidCredentialsUseSpecificSafeCode", async () => {
    const auth = new AuthService(authClientWithLoginError({ code: "invalid_credentials", message: "Invalid login credentials", status: 400 }));
    await assert.rejects(() => auth.login("user@example.com", "wrong-password"),
      (error: unknown) => error instanceof ApiError && error.status === 401 && error.code === "AUTH_INVALID_CREDENTIALS");
  });

  it("emailNotConfirmedUsesSpecificCode", async () => {
    const auth = new AuthService(authClientWithLoginError({ code: "email_not_confirmed", message: "Email not confirmed", status: 400 }));
    await assert.rejects(() => auth.login("user@example.com", "password"),
      (error: unknown) => error instanceof ApiError && error.status === 403 && error.code === "AUTH_EMAIL_NOT_CONFIRMED");
  });

  it("supabaseUnavailableUses503", async () => {
    const auth = new AuthService(authClientWithLoginError({ message: "fetch failed", status: 503 }));
    await assert.rejects(() => auth.login("user@example.com", "password"),
      (error: unknown) => error instanceof ApiError && error.status === 503 && error.code === "SUPABASE_UNAVAILABLE");
  });
});

function authClientWithLoginError(error: { code?: string; message?: string; status?: number }): never {
  return { auth: { signInWithPassword: async () => ({ data: {}, error }) } } as never;
}

function authClientWithSignupError(error: { code?: string; message?: string; status?: number }): never {
  return { auth: { signUp: async () => ({ data: {}, error }) } } as never;
}
