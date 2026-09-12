import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../errors/ApiError.js";
import type { AuthenticatedUser } from "../types/domain.js";
import type { AuthSessionResponse } from "../types/http.js";

export interface AuthProvider {
  signup(email: string, password: string): Promise<AuthSessionResponse | { requiresEmailConfirmation: true }>;
  login(email: string, password: string): Promise<AuthSessionResponse>;
  refresh(refreshToken: string): Promise<AuthSessionResponse>;
  /** Trades a Google ID token for the same session a password login returns. */
  google(idToken: string, nonce: string): Promise<AuthSessionResponse>;
  verify(accessToken: string): Promise<AuthenticatedUser>;
  requireRecentAuthentication(user: AuthenticatedUser): void;
}

export class AuthService implements AuthProvider {
  public constructor(private readonly auth: SupabaseClient) {}
  public async signup(email: string, password: string): Promise<AuthSessionResponse | { requiresEmailConfirmation: true }> {
    const { data, error } = await this.auth.auth.signUp({ email, password });
    if (error) {
      this.logSupabaseAuthError("signup", error);
      throw this.mapSignupError(error);
    }
    if (!data.session || !data.user) return { requiresEmailConfirmation: true };
    return this.response(data.session.access_token, data.session.refresh_token, data.session.expires_at ?? null, data.user.id, data.user.email);
  }
  public async login(email: string, password: string): Promise<AuthSessionResponse> {
    const { data, error } = await this.auth.auth.signInWithPassword({ email, password });
    if (error) {
      this.logSupabaseAuthError("login", error);
      throw this.mapLoginError(error);
    }
    if (!data.session || !data.user) throw new ApiError(503, "SUPABASE_UNAVAILABLE", "Autenticação temporariamente indisponível.");
    return this.response(data.session.access_token, data.session.refresh_token, data.session.expires_at ?? null, data.user.id, data.user.email);
  }
  /** Google Identity Services hands the browser an ID token; Supabase verifies it against
   *  the Google provider and the nonce, creating the account on first use - so signing up
   *  and signing in with Google are the same call. The raw nonce comes from the browser,
   *  which only ever showed Google its SHA-256. */
  public async google(idToken: string, nonce: string): Promise<AuthSessionResponse> {
    const { data, error } = await this.auth.auth.signInWithIdToken({ provider: "google", token: idToken, nonce });
    if (error) {
      this.logSupabaseAuthError("google", error);
      throw this.mapGoogleError(error);
    }
    if (!data.session || !data.user) throw new ApiError(503, "SUPABASE_UNAVAILABLE", "Autenticação temporariamente indisponível.");
    return this.response(data.session.access_token, data.session.refresh_token, data.session.expires_at ?? null, data.user.id, data.user.email);
  }
  public async refresh(refreshToken: string): Promise<AuthSessionResponse> {
    const { data, error } = await this.auth.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session || !data.user) throw new ApiError(401, "SESSION_EXPIRED", "Sua sessão expirou.");
    return this.response(data.session.access_token, data.session.refresh_token, data.session.expires_at ?? null, data.user.id, data.user.email);
  }
  public async verify(accessToken: string): Promise<AuthenticatedUser> {
    const { data, error } = await this.auth.auth.getUser(accessToken);
    if (error || !data.user?.email) throw new ApiError(401, "INVALID_TOKEN", "Token de autenticação inválido.");
    return { id: data.user.id, email: data.user.email, authenticatedAt: data.user.last_sign_in_at };
  }
  public requireRecentAuthentication(user: AuthenticatedUser): void {
    const authenticatedAt = user.authenticatedAt ? new Date(user.authenticatedAt).getTime() : 0;
    if (!authenticatedAt || Date.now() - authenticatedAt > 5 * 60 * 1000) {
      throw new ApiError(401, "REAUTHENTICATION_REQUIRED", "Confirme sua senha novamente antes de trocar o aparelho.");
    }
  }
  private response(accessToken: string, refreshToken: string, expiresAt: number | null, id: string, email?: string): AuthSessionResponse {
    if (!email) throw new ApiError(400, "EMAIL_REQUIRED", "A conta precisa possuir um e-mail.");
    return { accessToken, refreshToken, expiresAt, user: { id, email } };
  }

  private mapGoogleError(error: unknown): ApiError {
    const details = error as { code?: string; message?: string; status?: number };
    const code = String(details.code ?? "").toLowerCase();
    const message = String(details.message ?? "").toLowerCase();
    const status = Number(details.status ?? 0);
    if (code.includes("provider_disabled") || (message.includes("provider") && /not enabled|disabled|unsupported/.test(message))) {
      return new ApiError(503, "GOOGLE_AUTH_NOT_CONFIGURED", "O login com Google ainda não está configurado.");
    }
    if (status >= 500 || message.includes("fetch failed") || message.includes("network")) {
      return new ApiError(503, "SUPABASE_UNAVAILABLE", "Autenticação temporariamente indisponível.");
    }
    return new ApiError(401, "GOOGLE_TOKEN_INVALID", "Não foi possível confirmar sua conta Google. Tente novamente.");
  }

  private mapLoginError(error: unknown): ApiError {
    const details = error as { code?: string; message?: string; status?: number };
    const code = String(details.code ?? "").toLowerCase();
    const message = String(details.message ?? "").toLowerCase();
    const status = Number(details.status ?? 0);
    if (code.includes("email_not_confirmed") || message.includes("email not confirmed")) {
      return new ApiError(403, "AUTH_EMAIL_NOT_CONFIRMED", "Confirme seu e-mail antes de entrar.");
    }
    if (status >= 500 || message.includes("fetch failed") || message.includes("network")) {
      return new ApiError(503, "SUPABASE_UNAVAILABLE", "Autenticação temporariamente indisponível.");
    }
    return new ApiError(401, "AUTH_INVALID_CREDENTIALS", "E-mail ou senha inválidos.");
  }

  private mapSignupError(error: unknown): ApiError {
    const details = error as { code?: string; message?: string; status?: number };
    const code = String(details.code ?? "").toLowerCase();
    const message = String(details.message ?? "").toLowerCase();
    const status = Number(details.status ?? 0);
    if (status === 429 || code.includes("rate_limit") || message.includes("rate limit")) {
      return new ApiError(429, "AUTH_RATE_LIMITED", this.publicSupabaseMessage(details.message, "Muitas tentativas. Aguarde um pouco e tente novamente."));
    }
    if (status === 422 || code.includes("weak_password") || message.includes("password")) {
      return new ApiError(400, "AUTH_WEAK_PASSWORD", this.publicSupabaseMessage(details.message, "Senha recusada pelo Supabase."));
    }
    if (code.includes("email") || message.includes("email")) {
      return new ApiError(400, "AUTH_SIGNUP_EMAIL_REJECTED", this.publicSupabaseMessage(details.message, "E-mail recusado pelo Supabase."));
    }
    if (status >= 500 || message.includes("fetch failed") || message.includes("network")) {
      return new ApiError(503, "SUPABASE_UNAVAILABLE", "Autenticação temporariamente indisponível.");
    }
    return new ApiError(400, "AUTH_SIGNUP_FAILED", this.publicSupabaseMessage(details.message, "Não foi possível criar a conta."));
  }

  private logSupabaseAuthError(action: "signup" | "login" | "google", error: unknown): void {
    const details = error as { code?: string; message?: string; status?: number; name?: string };
    console.warn(JSON.stringify({
      event: "supabase.auth.error",
      action,
      status: details.status ?? null,
      code: details.code ?? null,
      name: details.name ?? null,
      message: details.message ?? String(error),
    }));
  }

  private publicSupabaseMessage(message: unknown, fallback: string): string {
    return typeof message === "string" && message.trim() ? message : fallback;
  }
}
