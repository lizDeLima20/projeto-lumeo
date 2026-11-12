import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogBookRecord } from "../catalog/types.js";

/**
 * Kindle editions: the AZW3 that the conversion worker (worker/kindle-converter, Calibre in
 * Docker) makes from a catalog EPUB, with its cover and metadata inside, kept in Supabase
 * Storage. The catalog itself, its Google Drive files and the way they are read stay as they are.
 */
export type KindleEditionFormat = "azw3";
export type KindleEditionStatus = "pending" | "processing" | "ready" | "failed";

export const KINDLE_EDITIONS_TABLE = "kindle_editions";
export const KINDLE_EDITIONS_BUCKET = "kindle-editions";
export const KINDLE_FILE_TYPES: Readonly<Record<KindleEditionFormat, string>> = { azw3: "application/vnd.amazon.mobi8-ebook" };
/** How long a signed download address stays valid: enough for the reader to follow it. */
export const KINDLE_SIGNED_URL_SECONDS = 600;

export interface KindleEdition {
  bookId: string;
  status: KindleEditionStatus;
  format: KindleEditionFormat | null;
  storagePath: string | null;
  size: number | null;
}

export interface KindleEditionReader {
  /** The editions known for these books (books the worker has not seen yet are absent). */
  editionsFor(bookIds: readonly string[]): Promise<ReadonlyMap<string, KindleEdition>>;
  /** A short-lived download address for a ready edition. */
  signedUrl(edition: KindleEdition): Promise<string>;
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
  if (edition?.status === "ready" && edition.format === "azw3" && edition.storagePath) return { status: "ready", format: "azw3", size: edition.size, edition };
  if (book.format !== "epub") return { status: "unavailable", format: null, size: null };
  return { status: !edition || edition.status === "ready" ? "pending" : edition.status, format: null, size: null };
}

const FORMATS = new Set<string>(["azw3"]);
const STATUSES = new Set<string>(["pending", "processing", "ready", "failed"]);
/** Supabase answers `in (...)` filters through the URL; pages are 30 books, this keeps it short. */
const IDS_PER_QUERY = 100;

/** kindle_editions and the kindle-editions bucket (supabase/migrations/*_kindle_editions.sql). */
export class SupabaseKindleEditions implements KindleEditionReader {
  public constructor(private readonly database: SupabaseClient, private readonly seconds = KINDLE_SIGNED_URL_SECONDS) {}

  public async editionsFor(bookIds: readonly string[]): Promise<ReadonlyMap<string, KindleEdition>> {
    const editions = new Map<string, KindleEdition>(), ids = [...new Set(bookIds)];
    for (let start = 0; start < ids.length; start += IDS_PER_QUERY) {
      const { data, error } = await this.database.from(KINDLE_EDITIONS_TABLE).select("book_id,status,format,storage_path,size_bytes").in("book_id", ids.slice(start, start + IDS_PER_QUERY));
      if (error) throw error;
      for (const row of data ?? []) {
        const edition = SupabaseKindleEditions.edition(row as Record<string, unknown>);
        if (edition) editions.set(edition.bookId, edition);
      }
    }
    return editions;
  }

  public async signedUrl(edition: KindleEdition): Promise<string> {
    if (!edition.storagePath) throw new Error("KINDLE_EDITION_NOT_READY");
    const { data, error } = await this.database.storage.from(KINDLE_EDITIONS_BUCKET).createSignedUrl(edition.storagePath, this.seconds);
    if (error || !data?.signedUrl) throw error ?? new Error("KINDLE_EDITION_SIGNED_URL_FAILED");
    return data.signedUrl;
  }

  public static edition(row: Record<string, unknown>): KindleEdition | null {
    const bookId = typeof row.book_id === "string" ? row.book_id : null, status = String(row.status);
    if (!bookId || !STATUSES.has(status)) return null;
    const format = typeof row.format === "string" && FORMATS.has(row.format) ? row.format as KindleEditionFormat : null;
    const storagePath = typeof row.storage_path === "string" && row.storage_path ? row.storage_path : null;
    const size = Number(row.size_bytes);
    return { bookId, status: status as KindleEditionStatus, format, storagePath, size: Number.isSafeInteger(size) && size > 0 ? size : null };
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
  public signedUrl(edition: KindleEdition): Promise<string> { return this.reader.signedUrl(edition); }
}
