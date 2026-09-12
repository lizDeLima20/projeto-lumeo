import { I18nManager } from "../i18n/I18nManager";
import { GoogleSignIn, type GoogleButtonText } from "../services/GoogleSignIn";

/** The Google option under an authentication form: Google's own button when Google is set
 *  up, and otherwise a plain button that says so when pressed - never a control that does
 *  nothing. A failed attempt paints a fresh button, so the retry gets a new nonce. */
export class GoogleAuthButton {
  public constructor(
    private readonly text: GoogleButtonText,
    private readonly onCredential: (credential: string, nonce: string) => Promise<void>,
    private readonly onMessage: (message: string) => void,
    private readonly google = new GoogleSignIn(),
  ) {}

  public render(): HTMLElement {
    const wrap = document.createElement("div"); wrap.className = "auth-alternative";
    const divider = document.createElement("div"); divider.className = "auth-divider"; divider.setAttribute("role", "separator");
    divider.textContent = I18nManager.shared.t("ui.auth.or");
    const host = document.createElement("div"); host.className = "auth-google";
    wrap.append(divider, host);
    if (!this.google.configured) { host.append(this.fallback(I18nManager.shared.t("ui.auth.google.notConfigured"))); return wrap; }
    host.append(this.fallback());
    queueMicrotask(() => void this.paint(host));
    return wrap;
  }

  private async paint(host: HTMLElement): Promise<void> {
    try {
      await this.google.render(host, this.text, (credential, nonce) => {
        host.classList.add("auth-google--busy");
        void this.onCredential(credential, nonce)
          .catch((error: unknown) => {
            this.onMessage(error instanceof Error && error.message ? error.message : I18nManager.shared.t("ui.auth.google.failed"));
            void this.paint(host);
          })
          .finally(() => host.classList.remove("auth-google--busy"));
      });
    } catch (error) {
      host.replaceChildren(this.fallback(error instanceof Error && error.message ? error.message : I18nManager.shared.t("ui.auth.google.unavailable")));
    }
  }

  private fallback(message?: string): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button"; button.className = "button button--google";
    const mark = document.createElement("span"); mark.className = "button--google__mark"; mark.setAttribute("aria-hidden", "true");
    button.append(mark, document.createTextNode(I18nManager.shared.t("ui.auth.google.continue")));
    if (message) button.addEventListener("click", () => this.onMessage(message)); else button.disabled = true;
    return button;
  }
}
