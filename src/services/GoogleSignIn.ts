import { I18nManager } from "../i18n/I18nManager";
import { GoogleIdentityServices, type GoogleIdApi } from "./GoogleIdentityServices";

export type GoogleButtonText = "signin_with" | "signup_with" | "continue_with";
interface ActiveGoogleLogin { callback: (credential: string, nonce: string) => void; }

/**
 * Google Identity login is initialized once per Client ID. Rendering another
 * Google button only changes its host; it never calls `id.initialize` again.
 */
export class GoogleSignIn {
  public static readonly scriptUrl = GoogleIdentityServices.scriptUrl;
  private static clientId: string | null = null;
  private static loginNonce: { raw: string; hashed: string } | null = null;
  private static active: ActiveGoogleLogin | null = null;
  public constructor(private readonly configuredClientId: string = import.meta.env?.VITE_GOOGLE_CLIENT_ID ?? "") {}
  public get configured(): boolean { return Boolean(this.configuredClientId.trim()); }

  /** Supabase checks the raw nonce against the SHA-256 value that Google saw. */
  public static async nonce(): Promise<{ raw: string; hashed: string }> {
    const hex = (bytes: Uint8Array): string => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    const raw = hex(crypto.getRandomValues(new Uint8Array(24)));
    return { raw, hashed: hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)))) };
  }
  public static locale(): string { const locale = I18nManager.shared.locale; return locale === "en-US" ? "en" : locale === "es" ? "es" : "pt-BR"; }
  public async load(): Promise<GoogleIdApi> { return (await GoogleIdentityServices.load()).accounts.id; }

  public async render(host: HTMLElement, text: GoogleButtonText, onCredential: (credential: string, nonce: string) => void): Promise<void> {
    const api = await this.load();
    await this.initializeOnce(api, text);
    GoogleSignIn.active = { callback: onCredential };
    host.replaceChildren();
    api.renderButton(host, { type: "standard", theme: "outline", size: "large", text, shape: "rectangular", logo_alignment: "left", width: Math.min(400, Math.max(220, Math.round(host.clientWidth || 320))), locale: GoogleSignIn.locale() });
  }

  private async initializeOnce(api: GoogleIdApi, text: GoogleButtonText): Promise<void> {
    const clientId = this.configuredClientId.trim();
    if (GoogleSignIn.clientId && GoogleSignIn.clientId !== clientId) throw new Error("GOOGLE_CLIENT_ID_CHANGED");
    if (GoogleSignIn.clientId) return;
    const nonce = GoogleSignIn.loginNonce ??= await GoogleSignIn.nonce();
    api.initialize({
      client_id: clientId, nonce: nonce.hashed, context: text === "signup_with" ? "signup" : "signin",
      ux_mode: "popup", itp_support: true, auto_select: false, cancel_on_tap_outside: true,
      callback: response => { if (response.credential && GoogleSignIn.active) GoogleSignIn.active.callback(response.credential, nonce.raw); },
    });
    GoogleSignIn.clientId = clientId;
  }
}
