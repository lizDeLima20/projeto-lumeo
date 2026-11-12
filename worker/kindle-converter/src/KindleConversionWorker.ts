import type { CatalogBookRecord, CatalogQuery, CatalogPage } from "../../../server/src/catalog/types.js";
import { KINDLE_FILE_TYPES } from "../../../server/src/kindle/KindleEditions.js";
import { PermanentConversionError, type EditionConverter } from "./CalibreConverter.js";
import { editionPath, planQueue, type EditionQueue, type EditionStorage } from "./EditionQueue.js";

/** A Drive folder the worker watches, read through the catalog's own provider (same ids, same data). */
export interface WatchedSource {
  sourceId: string;
  /** Lower first: Autoajuda is 10. */
  priority: number;
  locale: string;
  catalog: { list(query: CatalogQuery): Promise<CatalogPage> };
}

export interface WorkerSettings { workerId: string; maxAttempts: number; staleAfterMinutes: number; }
export type WorkerLog = (event: string, data?: Record<string, unknown>) => void;

export const jsonLog: WorkerLog = (event, data = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));

/**
 * The conversion engine: finds the catalog's EPUBs in Drive, queues the new or changed ones,
 * converts them one by one with Calibre and stores each AZW3 for the OPDS/Kindle extension to
 * offer. It runs in its own container, never inside a Vercel function.
 */
export class KindleConversionWorker {
  public constructor(
    private readonly sources: readonly WatchedSource[],
    private readonly queue: EditionQueue,
    private readonly storage: EditionStorage,
    private readonly converter: EditionConverter,
    private readonly settings: WorkerSettings,
    private readonly log: WorkerLog = jsonLog,
  ) {}

  /** Detects books to convert in every source, in priority order. Returns how many were queued. */
  public async scan(): Promise<number> {
    let queued = 0;
    for (const source of [...this.sources].sort((left, right) => left.priority - right.priority)) {
      try {
        const books = await this.allBooks(source);
        const plan = planQueue(source.sourceId, source.priority, books, await this.queue.known(source.sourceId));
        if (plan.jobs.length) await this.queue.enqueue(plan.jobs);
        queued += plan.jobs.length;
        this.log("KINDLE_SCAN", { sourceId: source.sourceId, books: books.length, queued: plan.jobs.length, unchanged: plan.unchanged, notEpub: plan.skipped });
      } catch (error) {
        // One unreadable folder must not stop the others.
        this.log("KINDLE_SCAN_FAILED", { sourceId: source.sourceId, reason: reason(error) });
      }
    }
    return queued;
  }

  /** Converts the next queued book. Returns false when the queue is empty. */
  public async processNext(): Promise<boolean> {
    const job = await this.queue.claim(this.settings.workerId, this.settings.maxAttempts, this.settings.staleAfterMinutes);
    if (!job) return false;
    const started = Date.now();
    try {
      const edition = await this.converter.convert(job);
      const path = editionPath(job.sourceId, job.bookId);
      await this.storage.upload(path, edition.bytes, KINDLE_FILE_TYPES.azw3);
      await this.queue.complete(job, this.settings.workerId, { format: "azw3", storagePath: path, size: edition.bytes.length, sha256: edition.sha256 });
      if (job.storagePath && job.storagePath !== path) await this.storage.remove(job.storagePath).catch(() => undefined);
      this.log("KINDLE_CONVERTED", { bookId: job.bookId, bytes: edition.bytes.length, seconds: Math.round((Date.now() - started) / 100) / 10, cover: edition.coverSource, repairedPaths: edition.repairedPaths, title: edition.info.title });
    } catch (error) {
      const permanent = error instanceof PermanentConversionError, final = permanent || job.attempts >= this.settings.maxAttempts;
      await this.queue.fail(job, this.settings.workerId, reason(error), final).catch((failure) => this.log("KINDLE_QUEUE_UPDATE_FAILED", { bookId: job.bookId, reason: reason(failure) }));
      this.log(final ? "KINDLE_FAILED" : "KINDLE_RETRY_LATER", { bookId: job.bookId, attempt: job.attempts, reason: reason(error) });
    }
    return true;
  }

  /** Scans every `scanIntervalMs`, drains the queue, waits `idleMs` when there is nothing to do. */
  public async run(signal: AbortSignal, timing: { scanIntervalMs: number; idleMs: number }): Promise<void> {
    let nextScan = 0;
    while (!signal.aborted) {
      if (Date.now() >= nextScan) { await this.scan(); nextScan = Date.now() + timing.scanIntervalMs; }
      let worked = false;
      while (!signal.aborted && Date.now() < nextScan) {
        let had: boolean;
        try { had = await this.processNext(); }
        catch (error) { this.log("KINDLE_QUEUE_UNAVAILABLE", { reason: reason(error) }); had = false; }
        if (!had) break;
        worked = true;
      }
      if (!worked) await sleep(timing.idleMs, signal);
    }
    this.log("KINDLE_WORKER_STOPPED", { workerId: this.settings.workerId });
  }

  private async allBooks(source: WatchedSource): Promise<CatalogBookRecord[]> {
    const books: CatalogBookRecord[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await source.catalog.list({ offset, limit: 500, locale: source.locale });
      books.push(...page.items);
      if (!page.nextCursor) return books;
    }
  }
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : (error as { message?: string })?.message ?? String(error)).slice(0, 2000);

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
    signal.addEventListener("abort", done, { once: true });
  });
}
