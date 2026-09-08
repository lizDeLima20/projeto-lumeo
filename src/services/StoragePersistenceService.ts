export interface StorageStatus { persistent: boolean; usage?: number; quota?: number; }
export class StoragePersistenceService {
  public async request(): Promise<boolean> { return typeof navigator !== "undefined" && Boolean(await navigator.storage?.persist?.()); }
  public async requestAfterImport(): Promise<boolean> { return this.request(); }
  public async status(): Promise<StorageStatus> { if (typeof navigator === "undefined" || !navigator.storage) return { persistent: false }; const [persistent, estimate] = await Promise.all([navigator.storage.persisted?.() ?? false, navigator.storage.estimate?.() ?? {}]); return { persistent, usage: estimate.usage, quota: estimate.quota }; }
}
