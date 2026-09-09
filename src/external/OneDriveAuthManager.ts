import type { PublicClientApplication, AccountInfo } from "@azure/msal-browser";
import type { OneDriveConfig } from "./OneDriveConfig";
import { OneDriveError } from "./OneDriveError";
export interface OneDriveAuth { token(): Promise<string | null>; invalidate(): void; }
export class OneDriveAuthManager implements OneDriveAuth {
  // /shares resolves shared links; Files.ReadWrite is its documented least
  // privileged delegated scope. The application itself issues only GETs.
  public static readonly SCOPES = ["Files.ReadWrite"];
  private client: PublicClientApplication | null = null;
  private account: AccountInfo | null = null;
  private initialization: Promise<void> | null = null;
  public constructor(private readonly config: OneDriveConfig) {}
  public prepare(): Promise<void> {
    if (!this.config.enabled || !this.config.clientId) return Promise.reject(new OneDriveError("onedrive.notConfigured"));
    if (!this.initialization) this.initialization = this.initialize().catch(() => {
      this.initialization = null; throw new OneDriveError("onedrive.authFailed");
    });
    return this.initialization;
  }
  private async initialize(): Promise<void> {
    const { PublicClientApplication } = await import("@azure/msal-browser");
    const client = new PublicClientApplication({ auth: { clientId: this.config.clientId,
      authority: `https://login.microsoftonline.com/${this.config.tenantId}`, redirectUri: this.config.redirectUri },
      cache: { cacheLocation: "memoryStorage", temporaryCacheLocation: "memoryStorage" },
      system: { loggerOptions: { loggerCallback: () => undefined, piiLoggingEnabled: false } },
    });
    await client.initialize(); this.client = client;
  }
  /** Invoked only by the Connect button, after prepare has resolved. */
  public async connect(): Promise<void> {
    if (!this.client) throw new OneDriveError("onedrive.notConfigured");
    try {
      const result = await this.client.loginPopup({ scopes: OneDriveAuthManager.SCOPES, prompt: "select_account" });
      this.account = result.account;
    } catch { throw new OneDriveError("onedrive.cancelled"); }
  }
  public async token(): Promise<string | null> {
    if (!this.client || !this.account) return null;
    try { return (await this.client.acquireTokenSilent({ scopes: OneDriveAuthManager.SCOPES, account: this.account })).accessToken; }
    catch { this.invalidate(); throw new OneDriveError("onedrive.authRequired"); }
  }
  public invalidate(): void { this.account = null; }
  public async dispose(): Promise<void> { this.account = null; await this.client?.clearCache(); this.client = null; this.initialization = null; }
}
