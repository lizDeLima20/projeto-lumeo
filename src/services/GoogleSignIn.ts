import { I18nManager } from "../i18n/I18nManager";

interface GoogleCredentialResponse { credential?: string; }
interface GoogleIdApi {
  initialize(config: {
    client_id: string; nonce: string; callback(response: GoogleCredentialResponse): void;
    context?: "signin" | "signup" | "use"; ux_mode?: "popup" | "redirect"; itp_support?: boolean; auto_select?: boolean; cancel_on_tap_outside?: boolean;
  }): void;
  renderButton(parent: HTMLElement, options: {
    type: "standard"; theme: "outline" | "filled_blue"; size: "large"; text: GoogleButtonText;
    shape: "pill" | "rectangular"; logo_alignment: "left" | "center"; width?: number; locale?: string;
  }): void;
}
type GoogleWindow = Window & { google?: { accounts?: { id?: GoogleIdApi } } };
export type GoogleButtonText = "signin_with" | "signup_with" | "continue_with";

/** Sign in with Google through Google Identity Services.
 *
 *  The browser only receives an ID token and passes it to the BFF, which trades it with
 *  Supabase for the very session a password login returns. Refresh, device binding and the
 *  licence check therefore work unchanged. A popup, not a redirect: a redirect leaves an
 *  installed PWA and often never comes back into it. */
export class GoogleSignIn {
  public static readonly scriptUrl = "https://accounts.google.com/gsi/client";
  private static loading: Promise<GoogleIdApi> | null = null;
  public constructor(private readonly clientId: string = import.meta.env?.VITE_GOOGLE_CLIENT_ID ?? "") {}
  public get configured(): boolean { return Boolean(this.clientId.trim()); }

  /** Supabase checks that the ID token carries SHA-256(nonce): Google sees only the hash,
   *  the server gets the raw value, and a token captured elsewhere cannot be replayed. */
  public static async nonce(): Promise<{ raw: string; hashed: string }> {
    const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const raw = hex(crypto.getRandomValues(new Uint8Array(24)));
    const hashed = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))));
    return { raw, hashed };
  }
  public static locale(): string {
    const locale = I18nManager.shared.locale;
    return locale === "en-US" ? "en" : locale === "es" ? "es" : "pt-BR";
  }

  /** The same script the Drive picker loads; it is only fetched once. */
  public load(): Promise<GoogleIdApi> {
    const ready = (window as GoogleWindow).google?.accounts?.id;
    if (ready) return Promise.resolve(ready);
    return GoogleSignIn.loading ??= new Promise<GoogleIdApi>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${GoogleSignIn.scriptUrl}"]`);
      const script = existing ?? Object.assign(document.createElement("script"), { src: GoogleSignIn.scriptUrl, async: true });
      const fail = (): void => { window.clearTimeout(timer); GoogleSignIn.loading = null; reject(new Error(I18nManager.shared.t("ui.auth.google.unavailable"))); };
      const done = (): void => { window.clearTimeout(timer); const api = (window as GoogleWindow).google?.accounts?.id; if (api) resolve(api); else fail(); };
      const timer = window.setTimeout(fail, 15_000);
      script.addEventListener("load", done, { once: true }); script.addEventListener("error", fail, { once: true });
      if (!existing) document.head.append(script);
    });
  }

  /** Paints Google's own button into `host`. Each call issues a fresh nonce. */
  public async render(host: HTMLElement, text: GoogleButtonText, onCredential: (credential: string, nonce: string) => void): Promise<void> {
    const api = await this.load();
    const { raw, hashed } = await GoogleSignIn.nonce();
    api.initialize({
      client_id: this.clientId, nonce: hashed, context: text === "signup_with" ? "signup" : "signin",
      ux_mode: "popup", itp_support: true, auto_select: false, cancel_on_tap_outside: true,
      callback: (response) => { if (response.credential) onCredential(response.credential, raw); },
    });
    host.replaceChildren();
    api.renderButton(host, {
      type: "standard", theme: "outline", size: "large", text, shape: "pill", logo_alignment: "left",
      width: Math.min(400, Math.max(220, Math.round(host.clientWidth || 320))), locale: GoogleSignIn.locale(),
    });
  }
}
