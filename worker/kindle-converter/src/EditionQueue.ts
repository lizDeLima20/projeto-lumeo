import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogBookRecord } from "../../../server/src/catalog/types.js";
import { KINDLE_EDITIONS_TABLE, type KindleEditionStatus } from "../../../server/src/kindle/KindleEditions.js";

/** What the AZW3 carries inside, taken from the catalog (not from the EPUB's own metadata). */
export interface EditionMetadata {
  title: string;
  author: string;
  language: string | null;
  synopsis: string | null;
  coverUrl: string | null;
  publisher: string | null;
  collection: string | null;
  volume: string | null;
  resourceKey: string | null;
  fileSize: number | null;
}

/** A book in the queue (one row of kindle_editions). */
export interface EditionJob {
  bookId: string;
  sourceId: string;
  priority: number;
  attempts: number;
  epubDriveFileId: string;
  epubSha256: string | null;
  metadata: EditionMetadata;
  /** The Drive file of a previous conversion: a new conversion overwrites it (same id). */
  driveFileId: string | null;
}

export interface KnownEdition { epubDriveFileId: string; epubSha256: string | null; metadata: EditionMetadata; status: KindleEditionStatus; }
/** What the database keeps of a converted book: the link to its Drive file, never the file. */
export interface CompletedEdition { format: "azw3"; driveFileId: string; size: number; sha256: string; }

export interface EditionQueue {
  known(sourceId: string): Promise<Map<string, KnownEdition>>;
  /** New books, and books whose EPUB or catalog data changed: queued (again) from scratch. */
  enqueue(jobs: readonly EditionJob[]): Promise<void>;
  claim(worker: string, maxAttempts: number, staleAfterMinutes: number): Promise<EditionJob | null>;
  complete(job: EditionJob, worker: string, edition: CompletedEdition): Promise<void>;
  /** A permanent failure (or the last attempt) is "failed"; otherwise the book goes back to the queue. */
  fail(job: EditionJob, worker: string, reason: string, final: boolean): Promise<void>;
  /** Back to the queue without spending the attempt: the book was fine, the storage was not. */
  release(job: EditionJob, worker: string, reason: string): Promise<void>;
}

/**
 * The storage cannot take files right now (login refused, folder missing, quota, rate limit,
 * Google down, no network). The conversion was fine, so the book goes back to the queue without
 * losing an attempt, and the worker waits before trying again.
 */
export class EditionStoreUnavailable extends Error {}

export interface StoredEdition { driveFileId: string; size: number; md5: string; }

/** Where the AZW3s are kept (the Drive folder "Lumeo Kindle AZW3"). */
export interface EditionStore {
  save(job: EditionJob, file: { name: string; bytes: Uint8Array; sha256: string }): Promise<StoredEdition>;
}

export function editionMetadata(book: CatalogBookRecord, publisher: string | null = null): EditionMetadata {
  return {
    title: book.title, author: book.author, language: book.language ?? null, synopsis: book.description?.trim() || null, coverUrl: book.coverUrl,
    publisher, collection: book.collection ?? null, volume: book.volume ?? null, resourceKey: book.resourceKey ?? null, fileSize: book.fileSize,
  };
}


const sameMetadata = (left: EditionMetadata, right: EditionMetadata) =>
  (["title", "author", "language", "synopsis", "coverUrl", "publisher", "collection", "volume"] as const).every((key) => (left[key] ?? null) === (right[key] ?? null));

/**
 * Which catalog books must be (re)converted: EPUBs never seen, and EPUBs whose Drive file,
 * checksum or catalog data (title, author, cover...) changed since their edition was made. Books
 * already queued, converted or failed with the same data are left alone; PDFs are not converted.
 */
export function planQueue(sourceId: string, priority: number, books: readonly CatalogBookRecord[], known: ReadonlyMap<string, KnownEdition>): { jobs: EditionJob[]; unchanged: number; skipped: number } {
  const jobs: EditionJob[] = []; let unchanged = 0, skipped = 0;
  for (const book of books) {
    if (book.format !== "epub") { skipped++; continue; }
    const metadata = editionMetadata(book), previous = known.get(book.bookId);
    if (previous && previous.epubDriveFileId === book.driveFileId && (previous.epubSha256 ?? null) === (book.sha256 ?? null) && sameMetadata(previous.metadata, metadata)) { unchanged++; continue; }
    jobs.push({ bookId: book.bookId, sourceId, priority, attempts: 0, epubDriveFileId: book.driveFileId, epubSha256: book.sha256 ?? null, metadata, driveFileId: null });
  }
  return { jobs, unchanged, skipped };
}

const PAGE = 1000;

/** kindle_editions + claim_kindle_edition() (supabase/migrations/202611120001_kindle_editions.sql). */
export class SupabaseEditionQueue implements EditionQueue {
  public constructor(private readonly database: SupabaseClient) {}

  public async known(sourceId: string): Promise<Map<string, KnownEdition>> {
    const known = new Map<string, KnownEdition>();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.database.from(KINDLE_EDITIONS_TABLE).select("book_id,epub_drive_file_id,epub_sha256,metadata,status").eq("source_id", sourceId).order("book_id").range(from, from + PAGE - 1);
      if (error) throw error;
      for (const row of data ?? []) known.set(row.book_id, { epubDriveFileId: row.epub_drive_file_id, epubSha256: row.epub_sha256, metadata: row.metadata as EditionMetadata, status: row.status });
      if (!data || data.length < PAGE) return known;
    }
  }

  public async enqueue(jobs: readonly EditionJob[]): Promise<void> {
    for (let start = 0; start < jobs.length; start += 200) {
      const rows = jobs.slice(start, start + 200).map((job) => ({
        book_id: job.bookId, source_id: job.sourceId, priority: job.priority, epub_drive_file_id: job.epubDriveFileId, epub_sha256: job.epubSha256,
        metadata: job.metadata, status: "pending", attempts: 0, last_error: null, locked_by: null, locked_at: null, updated_at: new Date().toISOString(),
      }));
      // An existing row keeps its file (format/drive_file_id) until the new conversion replaces it.
      const { error } = await this.database.from(KINDLE_EDITIONS_TABLE).upsert(rows, { onConflict: "book_id" });
      if (error) throw error;
    }
  }

  public async claim(worker: string, maxAttempts: number, staleAfterMinutes: number): Promise<EditionJob | null> {
    const { data, error } = await this.database.rpc("claim_kindle_edition", { p_worker: worker, p_max_attempts: maxAttempts, p_stale_after: `${staleAfterMinutes} minutes` });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      bookId: String(row.book_id), sourceId: String(row.source_id), priority: Number(row.priority), attempts: Number(row.attempts),
      epubDriveFileId: String(row.epub_drive_file_id), epubSha256: (row.epub_sha256 as string | null) ?? null, metadata: row.metadata as EditionMetadata,
      driveFileId: (row.drive_file_id as string | null) ?? null,
    };
  }

  public async complete(job: EditionJob, worker: string, edition: CompletedEdition): Promise<void> {
    const { error } = await this.database.from(KINDLE_EDITIONS_TABLE).update({
      status: "ready", format: edition.format, drive_file_id: edition.driveFileId, size_bytes: edition.size, sha256: edition.sha256,
      last_error: null, locked_by: null, locked_at: null, converted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("book_id", job.bookId).eq("locked_by", worker);
    if (error) throw error;
  }

  public async fail(job: EditionJob, worker: string, reason: string, final: boolean): Promise<void> {
    const { error } = await this.database.from(KINDLE_EDITIONS_TABLE).update({
      status: final ? "failed" : "pending", last_error: reason.slice(0, 2000), locked_by: null, locked_at: null, updated_at: new Date().toISOString(),
    }).eq("book_id", job.bookId).eq("locked_by", worker);
    if (error) throw error;
  }

  public async release(job: EditionJob, worker: string, reason: string): Promise<void> {
    const { error } = await this.database.from(KINDLE_EDITIONS_TABLE).update({
      status: "pending", attempts: Math.max(0, job.attempts - 1), last_error: reason.slice(0, 2000), locked_by: null, locked_at: null, updated_at: new Date().toISOString(),
    }).eq("book_id", job.bookId).eq("locked_by", worker);
    if (error) throw error;
  }
}


/** In memory: tests and the --dry-run mode (nothing is written to Supabase). */
export class MemoryEditionQueue implements EditionQueue {
  public readonly rows = new Map<string, EditionJob & { status: KindleEditionStatus; lockedBy: string | null; lastError: string | null; edition: CompletedEdition | null; createdAt: number }>();
  private clock = 0;
  public async known(sourceId: string) {
    return new Map([...this.rows.values()].filter((row) => row.sourceId === sourceId).map((row) => [row.bookId, { epubDriveFileId: row.epubDriveFileId, epubSha256: row.epubSha256, metadata: row.metadata, status: row.status }]));
  }
  public async enqueue(jobs: readonly EditionJob[]) {
    for (const job of jobs) {
      const previous = this.rows.get(job.bookId);
      this.rows.set(job.bookId, { ...job, attempts: 0, status: "pending", lockedBy: null, lastError: null, edition: previous?.edition ?? null, driveFileId: previous?.edition?.driveFileId ?? null, createdAt: previous?.createdAt ?? this.clock++ });
    }
  }
  public async claim(worker: string, maxAttempts: number) {
    const next = [...this.rows.values()].filter((row) => row.status === "pending" && row.attempts < maxAttempts).sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt)[0];
    if (!next) return null;
    next.status = "processing"; next.lockedBy = worker; next.attempts++;
    return { ...next };
  }
  public async complete(job: EditionJob, worker: string, edition: CompletedEdition) {
    const row = this.rows.get(job.bookId);
    if (row?.lockedBy !== worker) return;
    Object.assign(row, { status: "ready", edition, driveFileId: edition.driveFileId, lockedBy: null, lastError: null });
  }
  public async fail(job: EditionJob, worker: string, reason: string, final: boolean) {
    const row = this.rows.get(job.bookId);
    if (row?.lockedBy !== worker) return;
    Object.assign(row, { status: final ? "failed" : "pending", lockedBy: null, lastError: reason });
  }
  public async release(job: EditionJob, worker: string, reason: string) {
    const row = this.rows.get(job.bookId);
    if (row?.lockedBy !== worker) return;
    Object.assign(row, { status: "pending", attempts: Math.max(0, row.attempts - 1), lockedBy: null, lastError: reason });
  }
}
