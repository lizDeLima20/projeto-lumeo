export type CatalogBookStatus = "ACTIVE" | "UNAVAILABLE" | "PROCESSING" | "INVALID" | "ERROR";
export type CatalogFormat = "pdf" | "epub";
export type CatalogSourceMode = "auto" | "legacy" | "structured";
export type CatalogSourceProviderKind = Exclude<CatalogSourceMode, "auto"> | "authorized";

/** A source contains metadata only. Book and cover bytes always remain in Drive. */
export interface CatalogSourceConfig {
  sourceId: string;
  locale: string;
  folderId: string;
  mode: CatalogSourceMode;
  enabled: boolean;
  priority: number;
}

export interface CatalogSourceDiagnostic {
  sourceId: string;
  locale: string;
  mode: CatalogSourceProviderKind;
  provider: CatalogSourceProviderKind;
  audit?: CatalogSourceAudit;
}

export interface CatalogSourceAudit {
  foldersVisited: number; pagesFetched: number; rawItemsFound: number; filesSeen: number;
  supportedFiles: number; pdfCount: number; epubCount: number; shortcutCount: number;
  unsupportedCount: number; duplicates: number; parseFailures: number; finalCatalogCount: number;
}

export interface CatalogBookRecord {
  bookId: string;
  title: string;
  author: string;
  genreId: string;
  genreName: string;
  coverUrl: string | null;
  description: string | null;
  format: CatalogFormat;
  /** Original Drive filename. It is the legacy identity fallback only when
   * checksum and byte size are unavailable. */
  sourceFileName?: string | null;
  fileSize: number | null;
  driveFileId: string;
  resourceKey?: string | null;
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
export interface CatalogQuery { offset: number; limit: number; locale?: string; query?: string; genreId?: string; author?: string; format?: CatalogFormat; collection?: string; }
/** Metadata needed by the browser to download a public Drive file directly.
 * The BFF deliberately never proxies PDF or EPUB bytes. */
export interface CatalogDownloadLink {
  bookId: string;
  driveFileId: string;
  resourceKey?: string | null;
  downloadUrl: string;
  downloadUrls: readonly string[];
  title: string;
  author: string;
  genreId: string;
  genreName: string;
  format: CatalogFormat;
  sha256: string | null;
  coverUrl: string | null;
  fileSize: number | null;
  filename: string;
  expectedFilename: string;
  expiresAt: string | null;
}
export interface CatalogSyncReport { lastSyncedAt: string; total: number; created: number; updated: number; duplicates: number; failures: number; unavailable: number; audit?: CatalogSourceAudit; }
