export type CatalogBookStatus = "ACTIVE" | "UNAVAILABLE" | "PROCESSING" | "INVALID" | "ERROR";
export type CatalogFormat = "pdf" | "epub";

export interface CatalogBookRecord {
  bookId: string;
  title: string;
  author: string;
  genreId: string;
  genreName: string;
  coverUrl: string | null;
  description: string | null;
  format: CatalogFormat;
  fileSize: number | null;
  driveFileId: string;
  storageAccountId: string;
  sha256: string | null;
  volume: string | null;
  collection: string | null;
  language: string | null;
  createdAt: string;
  updatedAt: string;
  status: CatalogBookStatus;
}

export interface CatalogPage { items: readonly CatalogBookRecord[]; nextCursor: string | null; }
export interface CatalogQuery { offset: number; limit: number; query?: string; genreId?: string; author?: string; format?: CatalogFormat; collection?: string; }
/** Metadata needed by the browser to download a public Drive file directly.
 * The BFF deliberately never proxies PDF or EPUB bytes. */
export interface CatalogDownloadLink {
  bookId: string;
  downloadUrl: string;
  title: string;
  author: string;
  genreId: string;
  genreName: string;
  format: CatalogFormat;
  sha256: string | null;
  coverUrl: string | null;
  fileSize: number | null;
}
export interface CatalogSyncReport { lastSyncedAt: string; total: number; created: number; updated: number; duplicates: number; failures: number; unavailable: number; }
