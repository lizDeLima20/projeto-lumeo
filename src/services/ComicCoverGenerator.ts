import { ComicCoverCacheRepository } from "../repositories/ComicCoverCacheRepository";
import type { ApiClient } from "./ApiClient";
import { CoverService } from "./CoverService";
import type { DriveFolderEntry } from "./DriveCollectionService";
import { IndexedDbService } from "./IndexedDbService";
import { EMPTY_COMIC_METADATA, type ComicMetadata } from "./ComicPresentationService";

const DEFAULT_CONCURRENCY = 3;
export interface ComicCoverAsset { dataUrl: string; metadata: ComicMetadata }

/** Resolves a real cover for a CBR/CBZ Drive never rendered a thumbnail for, through the
 *  BFF's own comic-cover endpoint - never by downloading or opening the archive here.
 *  Google Drive's public download link answers a browser fetch() with a CORS-blocked 403
 *  (it only allows a request with no Origin header, which a real page never sends), so the
 *  archive is opened server-side instead; the browser only ever receives one small,
 *  already-resized image. Nothing is uploaded anywhere; the result only ever lives in the
 *  local cache. */
export class ComicCoverGenerator {
  private readonly inFlight = new Map<string, Promise<ComicCoverAsset | null>>();
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  public constructor(
    private readonly cache: ComicCoverCacheRepository,
    private readonly api: Pick<ApiClient, "getRaw">,
    private readonly covers = new CoverService(),
    private readonly concurrency = DEFAULT_CONCURRENCY,
  ) {}

  /** Resolves to a data URL cover, or null if this entry has none to generate, generation
   *  failed, or `shouldContinue` said to abandon it before it got its turn - the caller's
   *  placeholder covers every one of those the same way. Two callers asking for the same
   *  entry at once share the one attempt; a cached result never re-fetches anything. */
  public async cover(collectionId: string, entry: DriveFolderEntry, shouldContinue?: () => boolean): Promise<string | null> {
    return (await this.resolve(collectionId, entry, shouldContinue))?.dataUrl ?? null;
  }

  public async resolve(collectionId: string, entry: DriveFolderEntry, shouldContinue?: () => boolean): Promise<ComicCoverAsset | null> {
    if (entry.format !== "cbr" && entry.format !== "cbz") return null;
    const key = ComicCoverGenerator.cacheKey(entry);
    const cached = await this.cache.getEntry(key).catch(() => null);
    if (cached) return { dataUrl: cached.dataUrl, metadata: cached.metadata ?? EMPTY_COMIC_METADATA };
    const pending = this.inFlight.get(key);
    if (pending) {
      const resolved = await pending;
      if (resolved || shouldContinue) return resolved;
      this.inFlight.delete(key);
    }
    const work = this.runQueued(collectionId, entry, key, shouldContinue);
    this.inFlight.set(key, work);
    void work.finally(() => this.inFlight.delete(key));
    return work;
  }

  private static cacheKey(entry: DriveFolderEntry): string {
    return `${entry.id}:${entry.modifiedAt ?? "unknown"}`;
  }

  private async runQueued(collectionId: string, entry: DriveFolderEntry, key: string, shouldContinue?: () => boolean): Promise<ComicCoverAsset | null> {
    await this.acquire();
    try {
      // The queue can make an entry wait; if it left the screen in the meantime, this
      // abandons it instead of paying for a cover nobody will see.
      if (shouldContinue && !shouldContinue()) return null;
      return await this.generate(collectionId, entry, key);
    } finally { this.release(); }
  }

  private acquire(): Promise<void> {
    if (this.running < this.concurrency) { this.running++; return Promise.resolve(); }
    return new Promise(resolve => this.waiting.push(() => { this.running++; resolve(); }));
  }

  private release(): void {
    this.running--;
    this.waiting.shift()?.();
  }

  /** `entry.collectionPath` is the same root-to-file id trail the server's own /folders and
   *  /search-index already hand out - sent back verbatim, exactly like opening a folder or
   *  downloading a book does, never a Drive URL built here. The BFF re-validates it against
   *  the real collection before touching Drive. */
  private async generate(collectionId: string, entry: DriveFolderEntry, key: string): Promise<ComicCoverAsset | null> {
    try {
      const path = entry.collectionPath;
      if (!path?.length) return null;
      const response = await this.api.getRaw(
        `/collections/${encodeURIComponent(collectionId)}/comic-cover/${encodeURIComponent(entry.id)}?path=${encodeURIComponent(path.join(","))}`,
        false,
      );
      if (!response.ok) return null;
      const metadata = ComicCoverGenerator.metadata(response.headers);
      const dataUrl = await this.covers.fromBlob(await response.blob());
      await this.cache.save(key, dataUrl, metadata).catch(() => undefined);
      return { dataUrl, metadata };
    } catch { return null; }
  }

  private static metadata(headers: Headers): ComicMetadata {
    const read = (name: string): string | null => {
      const value = headers.get(name);
      if (!value) return null;
      try { return decodeURIComponent(value).trim() || null; } catch { return null; }
    };
    return {
      title: read("X-Comic-Title"), series: read("X-Comic-Series"), number: read("X-Comic-Number"),
      year: read("X-Comic-Year"), writer: read("X-Comic-Writer"), publisher: read("X-Comic-Publisher"),
      genre: read("X-Comic-Genre"), summary: read("X-Comic-Summary"),
    };
  }
}

let shared: ComicCoverGenerator | null = null;
let sharedApi: Pick<ApiClient, "getRaw"> | null = null;

/** Called once, at startup, with the app's own ApiClient - LazyCoverLoader's default
 *  parameter then resolves a real generator for the rest of the session without every view
 *  needing to thread one through by hand. */
export function configureComicCoverGenerator(api: Pick<ApiClient, "getRaw">): void { sharedApi = api; }

/** One generator (one cache, one concurrency budget, one in-flight map) for the whole
 *  session, so switching between screens never resets what has already been learned or
 *  starts a second, competing batch of downloads. Null before configureComicCoverGenerator()
 *  has run - LazyCoverLoader treats that exactly like "no generator available". */
export function defaultComicCoverGenerator(): ComicCoverGenerator | null {
  if (!sharedApi) return null;
  shared ??= new ComicCoverGenerator(new ComicCoverCacheRepository(new IndexedDbService()), sharedApi);
  return shared;
}
