import { I18nManager } from "../i18n/I18nManager";

export class GlobalErrorHandler {
  public constructor(private readonly root: HTMLElement | null = typeof document === "undefined" ? null : document.querySelector("#app")) {}

  public bind(): void {
    if (typeof window === "undefined") return;
    window.addEventListener("error", () => this.showFallback());
    window.addEventListener("unhandledrejection", () => this.showFallback());
  }

  public showFallback(): void {
    if (!this.root) return;
    const box = document.createElement("section");
    box.className = "page-shell";
    const title = document.createElement("h1");
    title.className = "page-title";
    title.textContent = I18nManager.shared.t("recovery.startupFailed");
    const text = document.createElement("p");
    text.className = "page-subtitle";
    text.textContent = I18nManager.shared.t("recovery.startupFailedHelp");
    box.append(title, text);
    this.root.replaceChildren(box);
  }
}
