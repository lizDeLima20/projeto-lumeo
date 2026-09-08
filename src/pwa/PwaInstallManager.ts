export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export class PwaInstallManager {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private dismissedAt = 0;
  private readonly cooldownMs = 1000 * 60 * 60 * 24 * 7;

  public bind(): void {
    if (typeof window === "undefined") return;
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      this.deferredPrompt = event as BeforeInstallPromptEvent;
    });
    window.addEventListener("appinstalled", () => {
      this.deferredPrompt = null;
      this.dismissedAt = 0;
    });
  }

  public canInstall(now = Date.now()): boolean {
    return this.deferredPrompt !== null && !this.isStandalone() && now - this.dismissedAt > this.cooldownMs;
  }

  public async install(): Promise<"accepted" | "dismissed" | "unavailable"> {
    if (!this.deferredPrompt) return "unavailable";
    await this.deferredPrompt.prompt();
    const result = (await this.deferredPrompt.userChoice).outcome;
    if (result === "dismissed") this.dismissedAt = Date.now();
    this.deferredPrompt = null;
    return result;
  }

  public isStandalone(): boolean {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  }
}
