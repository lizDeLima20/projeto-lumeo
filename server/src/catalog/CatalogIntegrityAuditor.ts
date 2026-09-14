import { createHash } from "node:crypto";
import { GoogleDrivePublicUrlResolver } from "./GoogleDrivePublicUrlResolver.js";
import type { CatalogDriveFile, CatalogDriveListing, GoogleCatalogDriveClient } from "./GoogleCatalogDriveClient.js";

export type CatalogIntegrityStatus = "OK" | "HASH_MISMATCH" | "SIZE_MISMATCH" | "FILE_NOT_FOUND" | "DRIVE_PERMISSION_ERROR" | "HTML_INSTEAD_OF_FILE" | "INVALID_PDF" | "INVALID_EPUB" | "CATALOG_METADATA_MISSING" | "DUPLICATE" | "OTHER";

export interface CatalogIntegrityEntry {
  driveFileId: string;
  sourceFileName: string;
  format: "pdf" | "epub";
  expectedSize: number | null;
  expectedSha256: string | null;
  actualSize: number | null;
  actualSha256: string | null;
  httpStatus: number | null;
  contentType: string | null;
  status: CatalogIntegrityStatus;
}

export interface CatalogIntegrityReport {
  generatedAt: string;
  totalFoundInSource: number;
  totalValid: number;
  totalInvalid: number;
  totalWithSha256: number;
  totalWithoutSourceSize: number;
  totalHashMismatch: number;
  totalSizeMismatch: number;
  totalDriveErrors: number;
  totalNotFound: number;
  totalDuplicates: number;
  entries: readonly CatalogIntegrityEntry[];
  sourceAudit: CatalogDriveListing["audit"];
}

type DriveInspector = Pick<GoogleCatalogDriveClient, "listCatalog" | "hashAndValidate">;

/**
 * Read-only diagnostic for a public catalogue source. It compares the bytes
 * fetched through the public browser URL with the canonical Drive API bytes.
 * It never writes catalog metadata or touches reader files.
 */
export class CatalogIntegrityAuditor {
  private readonly urls = new GoogleDrivePublicUrlResolver();
  public constructor(private readonly drive: DriveInspector, private readonly fetcher: typeof fetch = fetch) {}

  public async audit(): Promise<CatalogIntegrityReport> {
    const listing = await this.drive.listCatalog();
    const entries: CatalogIntegrityEntry[] = [];
    for (const file of listing.books) entries.push(await this.inspect(file));
    // A duplicate is only meaningful when the content identity is known. Do
    // not guess based on a title or a filename.
    const firstByHash = new Map<string, CatalogIntegrityEntry>();
    for (const entry of entries) {
      if (!entry.actualSha256 || entry.status !== "OK") continue;
      if (firstByHash.has(entry.actualSha256)) {
        const index = entries.indexOf(entry);
        entries[index] = { ...entry, status: "DUPLICATE" };
      } else firstByHash.set(entry.actualSha256, entry);
    }
    const count = (status: CatalogIntegrityStatus): number => entries.filter((entry) => entry.status === status).length;
    const totalDriveErrors = entries.filter((entry) => entry.status === "DRIVE_PERMISSION_ERROR" || entry.status === "HTML_INSTEAD_OF_FILE" || entry.status === "OTHER").length;
    return {
      generatedAt: new Date().toISOString(), totalFoundInSource: entries.length, totalValid: count("OK"), totalInvalid: entries.length - count("OK"),
      totalWithSha256: entries.filter((entry) => entry.expectedSha256 !== null).length, totalWithoutSourceSize: entries.filter((entry) => entry.expectedSize === null).length,
      totalHashMismatch: count("HASH_MISMATCH"), totalSizeMismatch: count("SIZE_MISMATCH"), totalDriveErrors, totalNotFound: count("FILE_NOT_FOUND"), totalDuplicates: count("DUPLICATE"), entries, sourceAudit: listing.audit,
    };
  }

  private async inspect(file: CatalogDriveFile): Promise<CatalogIntegrityEntry> {
    let expectedSha256: string | null = null;
    try { expectedSha256 = await this.drive.hashAndValidate(file); }
    catch { return this.entry(file, expectedSha256, null, null, null, "OTHER"); }
    try {
      const response = await this.fetcher(this.urls.resolve(file.id, file.format).downloadUrl, { redirect: "follow", headers: { Accept: file.format === "pdf" ? "application/pdf" : "application/epub+zip" } });
      if (response.status === 404) return this.entry(file, expectedSha256, null, response.status, response.headers.get("content-type"), "FILE_NOT_FOUND");
      if (response.status === 401 || response.status === 403) return this.entry(file, expectedSha256, null, response.status, response.headers.get("content-type"), "DRIVE_PERMISSION_ERROR");
      if (!response.ok || !response.body) return this.entry(file, expectedSha256, null, response.status, response.headers.get("content-type"), "OTHER");
      const actual = await this.read(response, file.format);
      if (actual.html) return this.entry(file, expectedSha256, actual, response.status, response.headers.get("content-type"), "HTML_INSTEAD_OF_FILE");
      if (!actual.valid) return this.entry(file, expectedSha256, actual, response.status, response.headers.get("content-type"), file.format === "pdf" ? "INVALID_PDF" : "INVALID_EPUB");
      if (file.size !== null && actual.size !== file.size) return this.entry(file, expectedSha256, actual, response.status, response.headers.get("content-type"), "SIZE_MISMATCH");
      if (expectedSha256 !== actual.sha256) return this.entry(file, expectedSha256, actual, response.status, response.headers.get("content-type"), "HASH_MISMATCH");
      if (file.size === null) return this.entry(file, expectedSha256, actual, response.status, response.headers.get("content-type"), "CATALOG_METADATA_MISSING");
      return this.entry(file, expectedSha256, actual, response.status, response.headers.get("content-type"), "OK");
    } catch { return this.entry(file, expectedSha256, null, null, null, "OTHER"); }
  }

  private async read(response: Response, format: CatalogDriveFile["format"]): Promise<{ size: number; sha256: string; valid: boolean; html: boolean }> {
    const hash = createHash("sha256"); const reader = response.body!.getReader(); let size = 0; let prefix = new Uint8Array();
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      if (!value) continue;
      size += value.byteLength; hash.update(value);
      if (prefix.length < 8) { const merged = new Uint8Array(Math.min(8, prefix.length + value.length)); merged.set(prefix); merged.set(value.slice(0, merged.length - prefix.length), prefix.length); prefix = merged; }
    }
    const html = new TextDecoder().decode(prefix).trimStart().toLocaleLowerCase().startsWith("<html") || new TextDecoder().decode(prefix).trimStart().toLocaleLowerCase().startsWith("<!doctype");
    const valid = format === "pdf" ? prefix.length >= 5 && new TextDecoder().decode(prefix.slice(0, 5)) === "%PDF-" : prefix.length >= 4 && prefix[0] === 0x50 && prefix[1] === 0x4b && prefix[2] === 3 && prefix[3] === 4;
    return { size, sha256: hash.digest("hex"), valid, html };
  }

  private entry(file: CatalogDriveFile, expectedSha256: string | null, actual: { size: number; sha256: string } | null, httpStatus: number | null, contentType: string | null, status: CatalogIntegrityStatus): CatalogIntegrityEntry {
    return { driveFileId: file.id, sourceFileName: file.name, format: file.format, expectedSize: file.size, expectedSha256, actualSize: actual?.size ?? null, actualSha256: actual?.sha256 ?? null, httpStatus, contentType, status };
  }
}
