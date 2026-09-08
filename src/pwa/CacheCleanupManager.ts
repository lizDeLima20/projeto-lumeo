export interface CacheStorageLike {
  keys(): Promise<string[]>;
  delete(key: string): Promise<boolean>;
}

export class CacheCleanupManager {
  private static readonly ESSENTIAL_PREFIXES = ["lumeo-shell-", "lumeo-assets-"];
  private static readonly TEMPORARY_PREFIXES = ["lumeo-runtime-", "lumeo-lookup-", "lumeo-rendered-pages-", "lumeo-thumbnails-"];

  public constructor(private readonly cacheStorage: CacheStorageLike | undefined = typeof caches === "undefined" ? undefined : caches) {}

  public async cleanupTemporary(): Promise<string[]> {
    if (!this.cacheStorage) return [];
    const keys = await this.cacheStorage.keys();
    const targets = keys.filter((key) => CacheCleanupManager.TEMPORARY_PREFIXES.some((prefix) => key.startsWith(prefix)));
    await Promise.all(targets.map((key) => this.cacheStorage?.delete(key)));
    return targets;
  }

  public async deleteOldAppCaches(currentCaches: readonly string[]): Promise<string[]> {
    if (!this.cacheStorage) return [];
    const keys = await this.cacheStorage.keys();
    const targets = keys.filter((key) => key.startsWith("lumeo-") && !currentCaches.includes(key));
    await Promise.all(targets.map((key) => this.cacheStorage?.delete(key)));
    return targets;
  }

  public isEssentialCache(name: string): boolean {
    return CacheCleanupManager.ESSENTIAL_PREFIXES.some((prefix) => name.startsWith(prefix));
  }
}
