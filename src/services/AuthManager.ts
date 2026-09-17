import type { AppState, User } from "../core/AppState";
import { ApiClient, ApiError } from "./ApiClient";
import { StorageService } from "./StorageService";

export interface AuthSession { accessToken: string; refreshToken: string; expiresAt: number | null; user: User; }
export type SignupResult = AuthSession | { requiresEmailConfirmation: true };

export class AuthManager {
  private static readonly SESSION_KEY = "auth-session";
  private refreshInFlight: Promise<void> | null = null;
  public constructor(private readonly api: ApiClient, private readonly storage: StorageService, private readonly state: AppState) {
    // Small test doubles from older callers need not implement the optional
    // retry hook; the production ApiClient always does.
    (this.api as Partial<ApiClient>).setSessionRefreshHandler?.(() => this.refreshPersistedSession());
  }

  public async initialize(): Promise<void> {
    this.state.authStatus = "AUTH_INITIALIZING";
    this.log("AUTH_BOOT_START");
    const saved = await this.storage.load<AuthSession>(AuthManager.SESSION_KEY);
    if (!saved || !saved.user?.id || !saved.user?.email || !saved.accessToken) return this.clearSession();
    this.log("SESSION_FOUND");
    const expired = !!saved.expiresAt && saved.expiresAt * 1000 < Date.now() + 30_000;
    // Supabase refresh tokens are opaque but always substantially larger than
    // the request validator's minimum. A short/stale persisted value cannot
    // be refreshed and used to create a noisy /auth/refresh 400 on startup.
    if (expired && saved.refreshToken.trim().length < 16) return this.clearSession();
    if(import.meta.env?.DEV)await this.rememberDevUser(saved.user);
    try {
      if (expired) this.log("ACCESS_TOKEN_EXPIRED");
      const session = expired ? await this.refresh(saved) : saved;
      await this.applySession(session);
      this.state.authStatus = "SESSION_RESTORED";
      this.log("SESSION_RESTORED");
      this.state.notify();
    } catch (error) {
      if (error instanceof ApiError && error.code === "NETWORK_ERROR") {
        this.restoreOffline(saved);
        return;
      }
      // Only an authentication refusal proves that the persisted refresh token
      // is unusable. A transient BFF/Supabase/server error must not log out a
      // reader or erase the recoverable session from WebView storage.
      if (error instanceof ApiError && (error.status === 400 || error.status === 401) && this.isRefreshRejection(error.code)) {
        this.state.authStatus = "EXPIRED";
        await this.clearSession();
        return;
      }
      this.restoreOffline(saved);
    }
  }

  public async signup(email: string, password: string): Promise<SignupResult> {
    const result = await this.api.post<SignupResult>("/auth/signup", { email, password }, false);
    if ("accessToken" in result) await this.applySession(result);
    return result;
  }
  public async login(email: string, password: string): Promise<void> {
    await this.applySession(await this.api.post<AuthSession>("/auth/login", { email, password }, false));
  }
  /** Google Identity Services ID token plus the raw nonce whose hash Google saw. */
  public async loginWithGoogle(credential: string, nonce: string): Promise<void> {
    await this.applySession(await this.api.post<AuthSession>("/auth/google", { credential, nonce }, false));
  }
  public async reauthenticate(password: string): Promise<void> {
    if (!this.state.currentUser) throw new Error("Usuário ausente.");
    await this.login(this.state.currentUser.email, password);
  }
  public async logout(): Promise<void> { await this.clearSession(); }
  public getSession(): User | null { return this.state.currentUser; }

  private async applySession(session: AuthSession): Promise<void> {
    if(import.meta.env?.DEV){const remembered=await this.storage.load<string>(this.devUserKey(session.user.email));if(remembered)session={...session,user:{...session.user,id:remembered}};else await this.rememberDevUser(session.user);}
    this.api.setAccessToken(session.accessToken);
    this.state.currentUser = session.user;
    this.state.authStatus = "AUTHENTICATED";
    await this.storage.save(AuthManager.SESSION_KEY, session);
    this.state.notify();
  }
  private devUserKey(email:string):string{return`dev-user:${email.trim().toLowerCase()}`;}
  private async rememberDevUser(user:User):Promise<void>{const key=this.devUserKey(user.email);if(!await this.storage.load<string>(key))await this.storage.save(key,user.id);}
  private async clearSession(): Promise<void> {
    this.api.setAccessToken(null);
    this.state.currentUser = null;
    this.state.authStatus = "unauthenticated";
    this.state.deviceStatus = "unknown";
    this.state.licenseStatus = "unknown";
    await this.storage.remove(AuthManager.SESSION_KEY);
    this.state.notify();
  }
  private restoreOffline(saved: AuthSession): void {
    this.api.setAccessToken(saved.accessToken);
    this.state.currentUser = saved.user;
    this.state.authStatus = "OFFLINE_AUTHENTICATED";
    this.state.deviceStatus = "authorized";
    this.state.licenseStatus = "offline_grace";
    this.state.notify();
  }
  private async refreshPersistedSession(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      const saved = await this.storage.load<AuthSession>(AuthManager.SESSION_KEY);
      if (!saved?.refreshToken || saved.refreshToken.trim().length < 16) throw new ApiError(401, "SESSION_EXPIRED", "Sua sessão expirou.");
      try { await this.applySession(await this.refresh(saved)); }
      catch (error) {
        if (error instanceof ApiError && (error.status === 400 || error.status === 401) && this.isRefreshRejection(error.code)) await this.clearSession();
        throw error;
      }
    })().finally(() => { this.refreshInFlight = null; });
    return this.refreshInFlight;
  }
  private async refresh(saved: AuthSession): Promise<AuthSession> {
    this.state.authStatus = "REFRESHING"; this.log("REFRESH_STARTED"); this.state.notify();
    try {
      const session = await this.api.post<AuthSession>("/auth/refresh", { refreshToken: saved.refreshToken }, false);
      this.log("REFRESH_SUCCESS"); return session;
    } catch (error) { this.log("REFRESH_FAILED"); throw error; }
  }
  private log(event: "AUTH_BOOT_START" | "SESSION_FOUND" | "ACCESS_TOKEN_EXPIRED" | "REFRESH_STARTED" | "REFRESH_SUCCESS" | "REFRESH_FAILED" | "SESSION_RESTORED"): void { console.info(JSON.stringify({ event })); }
  private isRefreshRejection(code: string): boolean {
    return ["SESSION_EXPIRED", "AUTH_INVALID_CREDENTIALS", "AUTH_REQUIRED", "AUTH_REFRESH_INVALID", "INVALID_REFRESH_TOKEN", "INVALID_TOKEN", "INVALID"].includes(code);
  }
}
