import { ComicArchiveSource } from "../reader/comic/ComicArchiveSource";
import { extractFirstCbzPage } from "../reader/comic/CbzFirstPageExtractor";
import { ComicCoverCacheRepository } from "../repositories/ComicCoverCacheRepository";
import { CoverService } from "./CoverService";
import type { DriveFolderEntry } from "./DriveCollectionService";
import { IndexedDbService } from "./IndexedDbService";

const DEFAULT_CONCURRENCY = 3;

/** Builds a real cover for a CBR/CBZ Drive never rendered a thumbnail for - the comic's
 *  own first page, read directly from the same public link the reader already downloads
 *  from. Nothing is uploaded anywhere; the result only ever lives in the local cache.
 *
 *  A CBZ (plain ZIP) needs only a couple of small byte ranges - its directory sits at the
 *  end of the file, so the whole archive is never fetched just to find page one. A CBR
 *  (RAR) has no such shortcut: RAR's compression is proprietary, and the only decoder this
 *  project has is libarchive.js, whose public API takes a complete file - so a CBR's cover
 *  costs a full download, same as actually opening it would. That cost is why this is
 *  strictly on-demand (only entries the reader scrolls to) and concurrency-limited. */
export class ComicCoverGenerator {
  private readonly inFlight = new Map<string, Promise<string | null>>();
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  public constructor(
    private readonly cache: ComicCoverCacheRepository,
    private readonly covers = new CoverService(),
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly concurrency = DEFAULT_CONCURRENCY,
    // Real RAR decoding needs libarchive.js's own WASM worker, which only a browser can
    // run - injectable so a test can stand in for it without a real archive.
    private readonly openArchive: (format: "cbr" | "cbz") => Pick<ComicArchiveSource, "open" | "image" | "close"> = format => new ComicArchiveSource(format),
  ) {}

  /** Resolves to a data URL cover, or null if this entry has none to generate, generation
   *  failed, or `shouldContinue` said to abandon it before it got its turn - the caller's
   *  placeholder covers every one of those the same way. Two callers asking for the same
   *  entry at once share the one attempt; a cached result never re-fetches anything. */
  public async cover(entry: DriveFolderEntry, shouldContinue?: () => boolean): Promise<string | null> {
    if (entry.format !== "cbr" && entry.format !== "cbz") return null;
    const key = ComicCoverGenerator.cacheKey(entry);
    const cached = await this.cache.get(key).catch(() => null);
    if (cached) return cached;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const work = this.runQueued(entry, key, shouldContinue);
    this.inFlight.set(key, work);
    void work.finally(() => this.inFlight.delete(key));
    return work;
  }

  private static cacheKey(entry: DriveFolderEntry): string {
    return `${entry.id}:${entry.modifiedAt ?? "unknown"}`;
  }

  private async runQueued(entry: DriveFolderEntry, key: string, shouldContinue?: () => boolean): Promise<string | null> {
    await this.acquire();
    try {
      // The queue can make an entry wait; if it left the screen in the meantime, this
      // abandons it instead of paying for a cover nobody will see.
      if (shouldContinue && !shouldContinue()) return null;
      return await this.generate(entry, key);
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

  private async generate(entry: DriveFolderEntry, key: string): Promise<string | null> {
    try {
      const dataUrl = entry.format === "cbz" ? await this.fromCbz(entry) : await this.fromCbr(entry);
      if (dataUrl) await this.cache.save(key, dataUrl).catch(() => undefined);
      return dataUrl;
    } catch { return null; }
  }

  /** Only the tail, the directory and one page's own bytes are ever fetched - see
   *  extractFirstCbzPage for exactly why that is enough for a real ZIP. */
  private async fromCbz(entry: DriveFolderEntry): Promise<string | null> {
    if (!entry.size) return null;
    const url = ComicCoverGenerator.downloadUrl(entry.id);
    const image = await extractFirstCbzPage(entry.size, (start, end) => this.fetchRange(url, start, end));
    return image ? this.covers.fromBlob(image) : null;
  }

  /** No shortcut exists for RAR here - the whole archive is downloaded and handed to the
   *  same engine the reader itself uses to open one. */
  private async fromCbr(entry: DriveFolderEntry): Promise<string | null> {
    const response = await this.fetchImpl(ComicCoverGenerator.downloadUrl(entry.id));
    if (!response.ok) return null;
    const blob = await response.blob();
    const archive = this.openArchive("cbr");
    try {
      await archive.open(blob);
      return await this.covers.fromBlob(await archive.image(1));
    } finally { await archive.close(); }
  }

  private async fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
    const response = await this.fetchImpl(url, { headers: { Range: `bytes=${start}-${end}` } });
    if (response.status !== 206 && response.status !== 200) throw new Error(`intervalo indisponível (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }

  /** The same public, read-only download link the library import flow already uses - never
   *  a write, never anything but the bytes Drive already serves anonymously. */
  private static downloadUrl(fileId: string): string {
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
  }
}

let shared: ComicCoverGenerator | null = null;
/** One generator (one cache, one concurrency budget, one in-flight map) for the whole
 *  session, so switching between screens never resets what has already been learned or
 *  starts a second, competing batch of downloads. */
export function defaultComicCoverGenerator(): ComicCoverGenerator {
  shared ??= new ComicCoverGenerator(new ComicCoverCacheRepository(new IndexedDbService()));
  return shared;
}