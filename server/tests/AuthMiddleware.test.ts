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

describe("AuthService com Google", () => {
  it("troca o ID token pela mesma sessao do login, repassando provedor e nonce", async () => {
    let received: unknown;
    const client = { auth: { signInWithIdToken: async (args: unknown) => { received = args; return { data: {
      session: { access_token: "access-token-value", refresh_token: "refresh-token-value", expires_at: 123 },
      user: { id: "00000000-0000-4000-8000-000000000001", email: "leitor@gmail.com" } }, error: null }; } } } as never;
    const session = await new AuthService(client).google("google-id-token", "raw-nonce-value-0000");
    assert.deepEqual(received, { provider: "google", token: "google-id-token", nonce: "raw-nonce-value-0000" });
    assert.deepEqual(session, { accessToken: "access-token-value", refreshToken: "refresh-token-value", expiresAt: 123, user: { id: "00000000-0000-4000-8000-000000000001", email: "leitor@gmail.com" } });
  });

  it("provedor desligado no Supabase vira 'nao configurado', nao 'senha errada'", async () => {
    const auth = new AuthService(authClientWithGoogleError({ code: "provider_disabled", message: "Provider (issuer \"https://accounts.google.com\") is not enabled", status: 400 }));
    await assert.rejects(() => auth.google("google-id-token", "raw-nonce-value-0000"),
      (error: unknown) => error instanceof ApiError && error.status === 503 && error.code === "GOOGLE_AUTH_NOT_CONFIGURED");
  });

  it("token ou nonce recusado e 401, e queda do Supabase e 503", async () => {
    await assert.rejects(() => new AuthService(authClientWithGoogleError({ message: "Nonces mismatch", status: 400 })).google("google-id-token", "raw-nonce-value-0000"),
      (error: unknown) => error instanceof ApiError && error.status === 401 && error.code === "GOOGLE_TOKEN_INVALID");
    await assert.rejects(() => new AuthService(authClientWithGoogleError({ message: "fetch failed", status: 503 })).google("google-id-token", "raw-nonce-value-0000"),
      (error: unknown) => error instanceof ApiError && error.status === 503 && error.code === "SUPABASE_UNAVAILABLE");
  });
});

function authClientWithGoogleError(error: { code?: string; message?: string; status?: number }): never {
  return { auth: { signInWithIdToken: async () => ({ data: {}, error }) } } as never;
}

function authClientWithLoginError(error: { code?: string; message?: string; status?: number }): never {
  return { auth: { signInWithPassword: async () => ({ data: {}, error }) } } as never;
}

function authClientWithSignupError(error: { code?: string; message?: string; status?: number }): never {
  return { auth: { signUp: async () => ({ data: {}, error }) } } as never;
}
