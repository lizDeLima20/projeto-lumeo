import { I18nManager } from "../i18n/I18nManager";
import { StartTelemetry } from "../diagnostics/StartTelemetry";

export class GlobalErrorHandler {
  public constructor(private readonly root: HTMLElement | null = typeof document === "undefined" ? null : document.querySelector("#app")) {}

  public bind(): void {
    if (typeof window === "undefined") return;
    // Late failures must not replace a working reader/import screen with the
    // startup fallback. They are recorded safely for diagnosis instead.
    window.addEventListener("error", event => this.report(event.error ?? event.message, "RUNTIME"));
    window.addEventListener("unhandledrejection", event => this.report(event.reason, "PROMISE"));
  }

  public showStartupFailure(error: unknown): void {
    this.report(error, "APP_START");
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

  private report(error: unknown, stage: string): void {
    StartTelemetry.failed("app", typeof location === "undefined" ? undefined : location.href,
      "ERROR", error instanceof Error ? new Error(`${stage}: ${error.message}`) : new Error(`${stage}: ${String(error)}`));
  }
}
