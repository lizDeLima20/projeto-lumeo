import { GoogleIdentityServices, type GoogleTokenClient, type GoogleTokenReply } from "./GoogleIdentityServices";

export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export type GoogleDriveAuthorizationErrorCode = "GOOGLE_DRIVE_AUTH_NOT_CONFIGURED" | "GOOGLE_OAUTH_CANCELLED" | "GOOGLE_OAUTH_ACCESS_DENIED" | "GOOGLE_DRIVE_TOKEN_EXPIRED";
export class GoogleDriveAuthorizationError extends Error {
  public constructor(public readonly code: GoogleDriveAuthorizationErrorCode, cause?: unknown) { super(code); this.name = "GoogleDriveAuthorizationError"; if (cause !== undefined) this.cause = cause; }
}
export type GoogleDriveTokenRequest = (prompt: "consent" | "") => Promise<GoogleTokenReply>;

interface StoredToken { value: string; expiresAt: number; }
interface TokenClientState { client: GoogleTokenClient; token: StoredToken | null; settle: ((reply: GoogleTokenReply | { transportError: { type?: string; message?: string } }) => void) | null; }

/**
 * Browser-only OAuth2 authorization for Drive. It never uses an ID token or
 * the Supabase session; the bearer token is memory-only and is reused until
 * shortly before expiry.
 */
export class GoogleDriveAuthorizationProvider {
  private static readonly clients = new Map<string, TokenClientState>();
  private pending: Promise<string> | null = null;
  public constructor(private readonly clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "", private readonly requestToken: GoogleDriveTokenRequest | null = null) {}
  public get configured(): boolean { return Boolean(this.clientId.trim()); }
  public get authorized(): boolean { return Boolean(this.currentToken()); }
  public clear(): void { const state = GoogleDriveAuthorizationProvider.clients.get(this.key()); if (state) state.token = null; }

  public async accessToken(): Promise<string> {
    const active = this.currentToken(); if (active) return active.value;
    if (!this.configured) throw new GoogleDriveAuthorizationError("GOOGLE_DRIVE_AUTH_NOT_CONFIGURED");
    return this.pending ??= this.request("consent").finally(() => { this.pending = null; });
  }

  private async request(prompt: "consent" | ""): Promise<string> {
    this.log("GOOGLE_DRIVE_TOKEN_REQUEST", { configured: this.configured });
    const reply = this.requestToken ? await this.requestToken(prompt) : await this.browserRequestToken(prompt);
    if (!reply.access_token?.trim()) {
      const error = this.authorizationError(reply.error);
      this.log("GOOGLE_DRIVE_TOKEN_ERROR", { code: error.code, googleCode: this.safeCode(reply.error) });
      throw error;
    }
    const token = { value: reply.access_token, expiresAt: Date.now() + Math.max(60, reply.expires_in ?? 3600) * 1000 - 30_000 };
    const state = this.state(); if (!this.requestToken && state) state.token = token;
    this.log("GOOGLE_DRIVE_TOKEN_SUCCESS", { expiresInSeconds: Math.max(60, reply.expires_in ?? 3600) });
    return token.value;
  }

  private async browserRequestToken(prompt: "consent" | ""): Promise<GoogleTokenReply> {
    const services = await GoogleIdentityServices.load();
    const state = this.getOrCreateState(services.accounts.oauth2.initTokenClient.bind(services.accounts.oauth2));
    if (state.settle) throw new GoogleDriveAuthorizationError("GOOGLE_OAUTH_CANCELLED");
    return new Promise<GoogleTokenReply>((resolve) => {
      state.settle = (reply) => { state.settle = null; resolve("transportError" in reply ? { error: reply.transportError.type ?? "popup_closed" } : reply); };
      state.client.requestAccessToken({ prompt });
    });
  }

  private getOrCreateState(create: (config: { client_id: string; scope: string; callback(response: GoogleTokenReply): void; error_callback(error?: { type?: string; message?: string }): void }) => GoogleTokenClient): TokenClientState {
    const key = this.key(), existing = GoogleDriveAuthorizationProvider.clients.get(key); if (existing) return existing;
    const state: TokenClientState = { client: undefined as never, token: null, settle: null };
    state.client = create({ client_id: this.clientId, scope: GOOGLE_DRIVE_FILE_SCOPE, callback: reply => state.settle?.(reply), error_callback: transportError => state.settle?.({ transportError: transportError ?? {} }) });
    GoogleDriveAuthorizationProvider.clients.set(key, state); return state;
  }
  private state(): TokenClientState | undefined { return GoogleDriveAuthorizationProvider.clients.get(this.key()); }
  private currentToken(): StoredToken | null { const token = this.state()?.token ?? null; return token && token.expiresAt > Date.now() + 30_000 ? token : null; }
  private key(): string { return `${this.clientId.trim()}|${GOOGLE_DRIVE_FILE_SCOPE}`; }
  private authorizationError(value: string | undefined): GoogleDriveAuthorizationError { if (value === "access_denied") return new GoogleDriveAuthorizationError("GOOGLE_OAUTH_ACCESS_DENIED"); if (value === "popup_closed" || value === "popup_failed_to_open" || value === "user_cancelled") return new GoogleDriveAuthorizationError("GOOGLE_OAUTH_CANCELLED"); return new GoogleDriveAuthorizationError("GOOGLE_DRIVE_TOKEN_EXPIRED"); }
  private safeCode(value: string | undefined): string | null { return value?.replace(/[^a-z0-9_.-]/gi, "").slice(0, 80) || null; }
  private log(event: string, details: Record<string, unknown>): void { console.info(JSON.stringify({ event, ...details })); }
}
