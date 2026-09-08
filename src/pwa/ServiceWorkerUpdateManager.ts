export interface PendingServiceWorker {
  postMessage(message: unknown): void;
}

export interface PendingServiceWorkerRegistration {
  waiting?: PendingServiceWorker | null;
}

export class ServiceWorkerUpdateManager {
  private pending: PendingServiceWorkerRegistration | null = null;
  public constructor(private readonly saveCriticalState: () => Promise<void> = async () => undefined) {}

  public notifyAvailable(registration: PendingServiceWorkerRegistration): void {
    this.pending = registration;
  }

  public hasUpdate(): boolean { return this.pending?.waiting != null; }

  public shouldDefer(readerOpen: boolean): boolean {
    return readerOpen && this.hasUpdate();
  }

  public async accept(reload: () => void): Promise<boolean> {
    if (!this.pending?.waiting) return false;
    await this.saveCriticalState();
    this.pending.waiting.postMessage({ type: "SKIP_WAITING" });
    reload();
    this.pending = null;
    return true;
  }
}
