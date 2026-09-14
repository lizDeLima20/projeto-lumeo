import { Capacitor } from "@capacitor/core";
import { I18nManager } from "../i18n/I18nManager";

/** A short branded continuation of Android's system splash screen. */
export class NativeLaunchSplash {
  private element: HTMLElement | null = null;

  public show(): void {
    if (!this.isAndroid() || this.element) return;
    const splash = document.createElement("section");
    splash.className = "native-launch-splash";
    splash.setAttribute("aria-label", I18nManager.shared.t("ui.splash.goodReading"));

    const logo = document.createElement("img");
    logo.className = "native-launch-splash__logo";
    logo.src = "/icons/lumeo-logo.png";
    logo.alt = "Lumeo";

    const copy = document.createElement("p");
    copy.className = "native-launch-splash__copy";
    copy.textContent = I18nManager.shared.t("ui.splash.goodReading");
    splash.append(logo, copy);
    document.body.prepend(splash);
    requestAnimationFrame(() => splash.classList.add("native-launch-splash--visible"));
    this.element = splash;
  }

  public async hide(): Promise<void> {
    const splash = this.element;
    if (!splash) return;
    splash.classList.add("native-launch-splash--leaving");
    await new Promise<void>(resolve => window.setTimeout(resolve, 220));
    splash.remove();
    this.element = null;
  }

  private isAndroid(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  }
}
