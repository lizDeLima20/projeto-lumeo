import { I18nManager } from "../i18n/I18nManager";

export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export type GoogleDriveAuthorizationErrorCode = "GOOGLE_DRIVE_AUTH_NOT_CONFIGURED" | "GOOGLE_DRIVE_CONSENT_DENIED" | "GOOGLE_DRIVE_TOKEN_EXPIRED";
export class GoogleDriveAuthorizationError extends Error {
  public constructor(public readonly code: GoogleDriveAuthorizationErrorCode, cause?: unknown) { super(code); this.name = "GoogleDriveAuthorizationError"; if (cause !== undefined) this.cause = cause; }
}
export interface GoogleDriveTokenReply { access_token?: string; expires_in?: number; error?: string; }
export type GoogleDriveTokenRequest = (prompt: "consent" | "") => Promise<GoogleDriveTokenReply>;

/** In-memory OAuth token only. It never receives Lumeo, Supabase, or Drive-owner credentials. */
export class GoogleDriveAuthorizationProvider {
  private token: { value: string; expiresAt: number } | null = null;
  public constructor(private readonly clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "", private readonly requestToken: GoogleDriveTokenRequest | null = null) {}
  public get configured(): boolean { return Boolean(this.clientId.trim()); }
  public get authorized(): boolean { return Boolean(this.token && this.token.expiresAt > Date.now()); }
  public clear(): void { this.token = null; }
  public async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    if (!this.configured) throw new GoogleDriveAuthorizationError("GOOGLE_DRIVE_AUTH_NOT_CONFIGURED");
    if (!await this.confirmConsent()) throw new GoogleDriveAuthorizationError("GOOGLE_DRIVE_CONSENT_DENIED");
    const reply = await (this.requestToken ?? this.browserRequestToken)("consent");
    if (!reply.access_token) throw new GoogleDriveAuthorizationError(reply.error === "access_denied" ? "GOOGLE_DRIVE_CONSENT_DENIED" : "GOOGLE_DRIVE_TOKEN_EXPIRED");
    this.token = { value: reply.access_token, expiresAt: Date.now() + Math.max(60, reply.expires_in ?? 3600) * 1000 - 30_000 }; return this.token.value;
  }
  private async browserRequestToken(prompt: "consent" | ""): Promise<GoogleDriveTokenReply> {
    await this.loadGsi();
    const google = (window as Window & { google?: { accounts?: { oauth2?: { initTokenClient(config: { client_id: string; scope: string; prompt: string; callback(value: GoogleDriveTokenReply): void; error_callback(): void }): { requestAccessToken(): void } } } }).google;
    if (!google?.accounts?.oauth2) throw new GoogleDriveAuthorizationError("GOOGLE_DRIVE_TOKEN_EXPIRED");
    return new Promise((resolve, reject) => google.accounts.oauth2!.initTokenClient({ client_id: this.clientId, scope: GOOGLE_DRIVE_FILE_SCOPE, prompt, callback: resolve,
      error_callback: () => reject(new GoogleDriveAuthorizationError("GOOGLE_DRIVE_CONSENT_DENIED")), }).requestAccessToken());
  }
  private async loadGsi(): Promise<void> {
    if ((window as Window & { google?: unknown }).google) return;
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]'), script = existing ?? document.createElement("script");
      const timeout = window.setTimeout(() => reject(new GoogleDriveAuthorizationError("GOOGLE_DRIVE_TOKEN_EXPIRED")), 20_000);
      const complete = (failure?: unknown): void => { window.clearTimeout(timeout); if (failure) reject(failure); else resolve(); };
      script.addEventListener("load", () => complete(), { once: true }); script.addEventListener("error", () => complete(new GoogleDriveAuthorizationError("GOOGLE_DRIVE_TOKEN_EXPIRED")), { once: true });
      if (!existing) { script.src = "https://accounts.google.com/gsi/client"; script.async = true; document.head.append(script); }
    });
  }
  private confirmConsent(): Promise<boolean> {
    if (typeof document === "undefined") return Promise.resolve(true);
    const i18n = I18nManager.shared;
    return new Promise((resolve) => {
      const overlay = document.createElement("div"); overlay.className = "catalog-genre-dialog";
      const dialog = document.createElement("section"); dialog.className = "catalog-genre-dialog__panel"; dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true");
      const title = document.createElement("h2"); title.textContent = i18n.t("ui.catalog.driveConsentTitle"); const text = document.createElement("p"); text.className = "catalog-genre-dialog__book"; text.textContent = i18n.t("ui.catalog.driveConsentHelp");
      const actions = document.createElement("div"); actions.className = "catalog-genre-dialog__actions";
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "button button--secondary"; cancel.textContent = i18n.t("ui.common.cancel");
      const continueButton = document.createElement("button"); continueButton.type = "button"; continueButton.className = "button button--primary"; continueButton.textContent = i18n.t("ui.catalog.driveConsentContinue");
      const close = (allowed: boolean): void => { overlay.remove(); resolve(allowed); };
      cancel.addEventListener("click", () => close(false)); continueButton.addEventListener("click", () => close(true)); overlay.addEventListener("click", (event) => { if (event.target === overlay) close(false); });
      actions.append(cancel, continueButton); dialog.append(title, text, actions); overlay.append(dialog); document.body.append(overlay); continueButton.focus();
    });
  }
}
