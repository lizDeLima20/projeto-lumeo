import { IndexedDbService, STORE_NAMES } from "../services/IndexedDbService";

export interface ComicCoverCacheEntry { key: string; dataUrl: string; updatedAt: string }

/** Generated CBR/CBZ cover thumbnails, kept only on this device - never uploaded, never
 *  part of the library's own data. A small, disposable cache: safe to clear entirely at
 *  any time without losing anything the reader cares about. */
export class ComicCoverCacheRepository {
  /** A count cap, not a byte budget - thumbnails are already small (a few dozen KB each),
   *  and few sessions browse past hundreds of covers, so counting entries is enough to
   *  keep this from growing without bound. */
  private static readonly MAX_ENTRIES = 500;
  public constructor(private readonly database: IndexedDbService) {}

  public async get(key: string): Promise<string | null> {
    const entry = await this.database.request<ComicCoverCacheEntry | undefined>(STORE_NAMES.comicCoverCache, "readonly", store => store.get(key));
    return entry?.dataUrl ?? null;
  }

  public async save(key: string, dataUrl: string): Promise<void> {
    await this.database.request(STORE_NAMES.comicCoverCache, "readwrite",
      store => store.put({ key, dataUrl, updatedAt: new Date().toISOString() } satisfies ComicCoverCacheEntry));
    await this.evictOldest();
  }

  private async evictOldest(): Promise<void> {
    const all = await this.database.request<ComicCoverCacheEntry[]>(STORE_NAMES.comicCoverCache, "readonly", store => store.getAll());
    if (all.length <= ComicCoverCacheRepository.MAX_ENTRIES) return;
    const excess = all.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).slice(0, all.length - ComicCoverCacheRepository.MAX_ENTRIES);
    await Promise.all(excess.map(entry => this.database.request(STORE_NAMES.comicCoverCache, "readwrite", store => store.delete(entry.key))));
  }
}
