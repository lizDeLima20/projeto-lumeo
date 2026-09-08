import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { ApiError } from "../errors/ApiError.js";
import type { AuthenticatedUser } from "../types/domain.js";
import type { AuthSessionResponse } from "../types/http.js";
import type { AuthProvider } from "./AuthService.js";

interface LocalAccount { id: string; email: string; passwordHash: Buffer; salt: Buffer; }
interface LocalSession { userId: string; expiresAt: number; authenticatedAt: string; }

export class LocalAuthService implements AuthProvider {
  private readonly accounts = new Map<string, LocalAccount>();
  private readonly accessTokens = new Map<string, LocalSession>();
  private readonly refreshTokens = new Map<string, string>();

  public async signup(email: string, password: string): Promise<AuthSessionResponse> {
    if (this.accounts.has(email)) throw new ApiError(409, "ACCOUNT_EXISTS", "Já existe uma conta com este e-mail.");
    const salt = randomBytes(16);
    const account: LocalAccount = { id: this.stableUserId(email), email, salt, passwordHash: scryptSync(password, salt, 64) };
    this.accounts.set(email, account);
    return this.createSession(account);
  }

  public async login(email: string, password: string): Promise<AuthSessionResponse> {
    let account = this.accounts.get(email);
    if (!account) {
      return this.signup(email, password);
    }
    const supplied = account ? scryptSync(password, account.salt, 64) : Buffer.alloc(64);
    if (!account || !timingSafeEqual(account.passwordHash, supplied)) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "E-mail ou senha inválidos.");
    }
    return this.createSession(account);
  }

  public async refresh(refreshToken: string): Promise<AuthSessionResponse> {
    const userId = this.refreshTokens.get(refreshToken);
    const account = [...this.accounts.values()].find((item) => item.id === userId);
    if (!account) throw new ApiError(401, "SESSION_EXPIRED", "Sua sessão expirou.");
    this.refreshTokens.delete(refreshToken);
    return this.createSession(account);
  }

  public async verify(accessToken: string): Promise<AuthenticatedUser> {
    const session = this.accessTokens.get(accessToken);
    const account = session ? [...this.accounts.values()].find((item) => item.id === session.userId) : null;
    if (!session || session.expiresAt < Date.now() || !account) throw new ApiError(401, "INVALID_TOKEN", "Token inválido.");
    return { id: account.id, email: account.email, authenticatedAt: session.authenticatedAt };
  }

  public requireRecentAuthentication(user: AuthenticatedUser): void {
    const time = user.authenticatedAt ? new Date(user.authenticatedAt).getTime() : 0;
    if (!time || Date.now() - time > 5 * 60 * 1000) throw new ApiError(401, "REAUTHENTICATION_REQUIRED", "Confirme sua senha novamente.");
  }

  private createSession(account: LocalAccount): AuthSessionResponse {
    const accessToken = randomBytes(32).toString("base64url");
    const refreshToken = randomBytes(32).toString("base64url");
    const expiresAtMs = Date.now() + 60 * 60 * 1000;
    this.accessTokens.set(accessToken, { userId: account.id, expiresAt: expiresAtMs, authenticatedAt: new Date().toISOString() });
    this.refreshTokens.set(refreshToken, account.id);
    return { accessToken, refreshToken, expiresAt: Math.floor(expiresAtMs / 1000), user: { id: account.id, email: account.email } };
  }
  private stableUserId(email: string): string { return `local-${createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24)}`; }
}
