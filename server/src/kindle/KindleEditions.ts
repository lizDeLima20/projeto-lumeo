import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogBookRecord } from "../catalog/types.js";
import { opdsDownloadUrl } from "../opds/OpdsDownloadService.js";

/**
 * Kindle editions: the AZW3 that the conversion worker (worker/kindle-converter, Calibre in
 * Docker) makes from a catalog EPUB, with its cover and metadata inside, kept in the Google Drive
 * folder "Lumeo Kindle AZW3". Supabase only records the link (Drive id, checksum, size, format).
 * The catalog itself, its Google Drive files and the way they are read stay as they are.
 */
export type KindleEditionFormat = "azw3";
export type KindleEditionStatus = "pending" | "processing" | "ready" | "failed";

export const KINDLE_EDITIONS_TABLE = "kindle_editions";
export const KINDLE_FILE_TYPES: Readonly<Record<KindleEditionFormat, string>> = { azw3: "application/vnd.amazon.mobi8-ebook" };
/** The Drive folder (in the account that owns the catalog) where the worker keeps the AZW3s. */
export const KINDLE_DRIVE_FOLDER_NAME = "Lumeo Kindle AZW3";

export interface KindleEdition {
  bookId: string;
  status: KindleEditionStatus;
  format: KindleEditionFormat | null;
  /** The converted file in the "Lumeo Kindle AZW3" Drive folder. */
  driveFileId: string | null;
  size: number | null;
}

export interface KindleEditionReader {
  /** The editions known for these books (books the worker has not seen yet are absent). */
  editionsFor(bookIds: readonly string[]): Promise<ReadonlyMap<string, KindleEdition>>;
}

/** Where a ready edition is downloaded: its Drive file, through the same direct-download address
 *  the catalog's EPUBs use. Only the authenticated download route hands it out. */
export function kindleDownloadUrl(edition: Pick<KindleEdition, "driveFileId">): string {
  if (!edition.driveFileId) throw new Error("KINDLE_EDITION_NOT_READY");
  return opdsDownloadUrl({ driveFileId: edition.driveFileId, resourceKey: null });
}

/**
 * What the Kindle gets for a book, decided once here for the OPDS feed, the Kindle extension and
 * the download route alike. Only a real AZW3 (converted by Calibre, cover and metadata inside)
 * goes to the Kindle library; an EPUB still waiting for it is "pending"/"processing", one whose
 * conversion failed is "failed", and a book that is not an EPUB (a catalog PDF) is "unavailable".
 */
export type KindleOffer =
  | { status: "ready"; format: KindleEditionFormat; size: number | null; edition: KindleEdition }
  | { status: "pending" | "processing" | "failed" | "unavailable"; format: null; size: null };

export function kindleOffer(book: Pick<CatalogBookRecord, "format">, edition: KindleEdition | undefined): KindleOffer {
  if (edition?.status === "ready" && edition.format === "azw3" && edition.driveFileId) return { status: "ready", format: "azw3", size: edition.size, edition };
  if (book.format !== "epub") return { status: "unavailable", format: null, size: null };
  return { status: !edition || edition.status === "ready" ? "pending" : edition.status, format: null, size: null };
}

const FORMATS = new Set<string>(["azw3"]);
const STATUSES = new Set<string>(["pending", "processing", "ready", "failed"]);
/** Supabase answers `in (...)` filters through the URL; pages are 30 books, this keeps it short. */
const IDS_PER_QUERY = 100;

/** Drive file ids are letters, digits, "-" and "_"; anything else in the column is not trusted. */
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;

/** kindle_editions (supabase/migrations/*_kindle_editions.sql). */
export class SupabaseKindleEditions implements KindleEditionReader {
  public constructor(private readonly database: SupabaseClient) {}

  public async editionsFor(bookIds: readonly string[]): Promise<ReadonlyMap<string, KindleEdition>> {
    const editions = new Map<string, KindleEdition>(), ids = [...new Set(bookIds)];
    for (let start = 0; start < ids.length; start += IDS_PER_QUERY) {
      const { data, error } = await this.database.from(KINDLE_EDITIONS_TABLE).select("book_id,status,format,drive_file_id,size_bytes").in("book_id", ids.slice(start, start + IDS_PER_QUERY));
      if (error) throw error;
      for (const row of data ?? []) {
        const edition = SupabaseKindleEditions.edition(row as Record<string, unknown>);
        if (edition) editions.set(edition.bookId, edition);
      }
    }
    return editions;
  }

  public static edition(row: Record<string, unknown>): KindleEdition | null {
    const bookId = typeof row.book_id === "string" ? row.book_id : null, status = String(row.status);
    if (!bookId || !STATUSES.has(status)) return null;
    const format = typeof row.format === "string" && FORMATS.has(row.format) ? row.format as KindleEditionFormat : null;
    const driveFileId = typeof row.drive_file_id === "string" && DRIVE_ID.test(row.drive_file_id) ? row.drive_file_id : null;
    const size = Number(row.size_bytes);
    return { bookId, status: status as KindleEditionStatus, format, driveFileId, size: Number.isSafeInteger(size) && size > 0 ? size : null };
  }
}

/**
 * Wraps a reader so the catalog never breaks because of the editions: when their table cannot be
 * read (e.g. the migration is not applied yet) the books are simply listed without Kindle editions.
 */
export class TolerantKindleEditions implements KindleEditionReader {
  public constructor(private readonly reader: KindleEditionReader) {}
  public async editionsFor(bookIds: readonly string[]): Promise<ReadonlyMap<string, KindleEdition>> {
    if (bookIds.length === 0) return new Map();
    try { return await this.reader.editionsFor(bookIds); }
    catch (error) {
      console.warn(JSON.stringify({ event: "KINDLE_EDITIONS_UNAVAILABLE", reason: error instanceof Error ? error.message : (error as { message?: string })?.message ?? "unknown" }));
      return new Map();
    }
  }
}
