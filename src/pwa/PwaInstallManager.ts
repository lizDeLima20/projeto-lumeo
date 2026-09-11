export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export class PwaInstallManager {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private readonly listeners = new Set<() => void>();
  private dismissedAt = 0;
  private readonly cooldownMs = 1000 * 60 * 60 * 24 * 7;

  public bind(): void {
    if (typeof window === "undefined") return;
    /* The event is kept for the install button but NOT prevented. preventDefault() hid
       Chrome's own install offer on Android, and nothing in the app replaced it, so the
       only way to install was hunting through the browser menu. */
    window.addEventListener("beforeinstallprompt", (event) => {
      this.deferredPrompt = event as BeforeInstallPromptEvent;
      this.notify();
    });
    window.addEventListener("appinstalled", () => {
      this.deferredPrompt = null;
      this.dismissedAt = 0;
      this.notify();
    });
  }

  /** The browser has offered installation and the app is not already running installed.
   *  Unlike canInstall(), no cooldown: this backs a button the reader pressed on purpose. */
  public get available(): boolean { return this.deferredPrompt !== null && !this.isStandalone(); }
  public get installed(): boolean { return this.isStandalone(); }
  /** iOS never fires beforeinstallprompt; Safari installs only from the Share sheet. */
  public get needsManualSteps(): boolean {
    if (typeof navigator === "undefined") return false;
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  public onChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify(): void { this.listeners.forEach((listener) => listener()); }

  public canInstall(now = Date.now()): boolean {
    return this.deferredPrompt !== null && !this.isStandalone() && now - this.dismissedAt > this.cooldownMs;
  }

  public async install(): Promise<"accepted" | "dismissed" | "unavailable"> {
    if (!this.deferredPrompt) return "unavailable";
    try { await this.deferredPrompt.prompt(); } catch { this.deferredPrompt = null; this.notify(); return "unavailable"; }
    const result = (await this.deferredPrompt.userChoice).outcome;
    if (result === "dismissed") this.dismissedAt = Date.now();
    this.deferredPrompt = null;
    this.notify();
    return result;
  }

  public isStandalone(): boolean {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  }
}
