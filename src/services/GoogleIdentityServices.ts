/** One loader shared by Google sign-in and Drive authorization. */
export interface GoogleCredentialResponse { credential?: string; }
export interface GoogleIdApi {
  initialize(config: { client_id: string; nonce: string; callback(response: GoogleCredentialResponse): void; context?: "signin" | "signup" | "use"; ux_mode?: "popup" | "redirect"; itp_support?: boolean; auto_select?: boolean; cancel_on_tap_outside?: boolean }): void;
  renderButton(parent: HTMLElement, options: { type: "standard"; theme: "outline" | "filled_blue"; size: "large"; text: "signin_with" | "signup_with" | "continue_with"; shape: "pill" | "rectangular"; logo_alignment: "left" | "center"; width?: number; locale?: string }): void;
}
export interface GoogleTokenReply { access_token?: string; expires_in?: number; error?: string; error_description?: string; }
export interface GoogleTokenClient { requestAccessToken(options?: { prompt?: "consent" | "" }): void; }
export interface GoogleOauth2Api { initTokenClient(config: { client_id: string; scope: string; callback(response: GoogleTokenReply): void; error_callback(error?: { type?: string; message?: string }): void }): GoogleTokenClient; }
export interface GoogleIdentityServicesApi { accounts: { id: GoogleIdApi; oauth2: GoogleOauth2Api; }; }
type GoogleWindow = Window & { google?: GoogleIdentityServicesApi };

export class GoogleIdentityServices {
  public static readonly scriptUrl = "https://accounts.google.com/gsi/client";
  private static loading: Promise<GoogleIdentityServicesApi> | null = null;
  public static load(): Promise<GoogleIdentityServicesApi> {
    const ready = (window as GoogleWindow).google?.accounts;
    if (ready?.id && ready.oauth2) return Promise.resolve((window as GoogleWindow).google!);
    return GoogleIdentityServices.loading ??= new Promise<GoogleIdentityServicesApi>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${GoogleIdentityServices.scriptUrl}"]`);
      const script = existing ?? Object.assign(document.createElement("script"), { src: GoogleIdentityServices.scriptUrl, async: true });
      let timer = 0;
      const finish = (error?: Error): void => {
        window.clearTimeout(timer);
        if (error) { GoogleIdentityServices.loading = null; reject(error); return; }
        const api = (window as GoogleWindow).google;
        if (api?.accounts?.id && api.accounts.oauth2) resolve(api);
        else { GoogleIdentityServices.loading = null; reject(new Error("GOOGLE_IDENTITY_UNAVAILABLE")); }
      };
      timer = window.setTimeout(() => finish(new Error("GOOGLE_IDENTITY_TIMEOUT")), 15_000);
      script.addEventListener("load", () => finish(), { once: true });
      script.addEventListener("error", () => finish(new Error("GOOGLE_IDENTITY_LOAD_FAILED")), { once: true });
      if (!existing) document.head.append(script);
    });
  }
}
