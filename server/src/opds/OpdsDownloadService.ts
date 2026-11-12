import type { CatalogBookRecord } from "../catalog/types.js";
import type { OpdsStore } from "./OpdsUserRepository.js";

export const OPDS_DOWNLOAD_WINDOW_MS = 60 * 60_000;

/**
 * Where a catalog book is downloaded from: Drive's own download address, answered with a 302
 * by the catalog. The bytes never pass through the function (Vercel answers at most 4.5 MB per
 * response), and KOReader follows the redirect without sending the catalog password to Drive.
 * `confirm=t` skips the "cannot scan for viruses" page Drive shows for large files.
 */
export function opdsDownloadUrl(book: Pick<CatalogBookRecord, "driveFileId" | "resourceKey">): string {
  const url = new URL("https://drive.usercontent.google.com/download");
  url.searchParams.set("id", book.driveFileId);
  url.searchParams.set("export", "download");
  url.searchParams.set("confirm", "t");
  if (book.resourceKey) url.searchParams.set("resourcekey", book.resourceKey);
  return url.toString();
}

export interface OpdsDownloadTarget { format: string; bytes: number | null; url: () => Promise<string>; }
export type OpdsDownloadResult = { kind: "redirect"; url: string } | { kind: "limited"; retryAfterSeconds: number };

/** Each download is recorded (opds_downloads) and limited per reader per hour. */
export class OpdsDownloadService {
  public constructor(private readonly store: OpdsStore, private readonly perHour: number, private readonly now: () => Date = () => new Date()) {}

  /** `target` gives where the file is: the catalog's own Drive file unless told otherwise (the
   *  Kindle edition). It is only asked for once the limit allows the download. */
  public async download(userId: string, book: CatalogBookRecord, target: OpdsDownloadTarget = { format: book.format, bytes: book.fileSize, url: async () => opdsDownloadUrl(book) }): Promise<OpdsDownloadResult> {
    const since = new Date(this.now().getTime() - OPDS_DOWNLOAD_WINDOW_MS);
    if (await this.store.downloadsSince(userId, since) >= this.perHour) return { kind: "limited", retryAfterSeconds: OPDS_DOWNLOAD_WINDOW_MS / 1000 };
    const url = await target.url();
    await this.store.recordDownload(userId, book.bookId);
    console.info(JSON.stringify({ event: "OPDS_DOWNLOAD", userId, bookId: book.bookId, format: target.format, bytes: target.bytes }));
    return { kind: "redirect", url };
  }
}
