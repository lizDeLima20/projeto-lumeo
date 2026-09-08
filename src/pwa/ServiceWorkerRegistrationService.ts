import { ServiceWorkerUpdateManager } from "./ServiceWorkerUpdateManager";

export class ServiceWorkerRegistrationService {
  public constructor(private readonly updateManager = new ServiceWorkerUpdateManager()) {}

  public register(enabled: boolean): void {
    if (!enabled || typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js").then((registration) => {
        if (registration.waiting) this.updateManager.notifyAvailable(registration);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) this.updateManager.notifyAvailable(registration);
          });
        });
      });
    });
  }
}
