import type { AppState, User } from "../core/AppState";
import { ApiClient, ApiError } from "./ApiClient";
import { StorageService } from "./StorageService";

export interface AuthSession { accessToken: string; refreshToken: string; expiresAt: number | null; user: User; }
export type SignupResult = AuthSession | { requiresEmailConfirmation: true };

export class AuthManager {
  private static readonly SESSION_KEY = "auth-session";
  public constructor(private readonly api: ApiClient, private readonly storage: StorageService, private readonly state: AppState) {}

  public async initialize(): Promise<void> {
    this.state.authStatus = "UNKNOWN";
    const saved = await this.storage.load<AuthSession>(AuthManager.SESSION_KEY);
    if (!saved || !saved.user?.id || !saved.user?.email || !saved.accessToken) return this.clearSession();
    const expired = !!saved.expiresAt && saved.expiresAt * 1000 < Date.now() + 30_000;
    if (expired && !saved.refreshToken?.trim()) return this.clearSession();
    if(import.meta.env?.DEV)await this.rememberDevUser(saved.user);
    try {
      const session = expired
        ? await this.api.post<AuthSession>("/auth/refresh", { refreshToken: saved.refreshToken }, false)
        : saved;
      await this.applySession(session);
    } catch (error) {
      if (error instanceof ApiError && error.code === "NETWORK_ERROR") {
        this.api.setAccessToken(saved.accessToken);
        this.state.currentUser = saved.user;
        this.state.authStatus = "OFFLINE_AUTHENTICATED";
        this.state.deviceStatus = "authorized";
        this.state.licenseStatus = "offline_grace";
        this.state.notify();
        return;
      }
      this.state.authStatus = "EXPIRED";
      await this.clearSession();
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
    this.state.authStatus = "authenticated";
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
}
