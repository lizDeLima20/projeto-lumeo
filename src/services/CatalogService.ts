import type { ApiClient } from "./ApiClient";
import type { CatalogBookData, CatalogPage } from "../models/CatalogBook";
import { I18nManager } from "../i18n/I18nManager";

export interface CatalogDownloadLink {
  bookId: string;
  driveFileId: string;
  downloadUrl: string;
  downloadUrls?: readonly string[];
  title: string;
  author: string;
  genreId: string;
  genreName: string;
  format: CatalogBookData["format"];
  sha256?: string | null;
  coverUrl?: string | null;
  fileSize?: number | null;
  resourceKey?: string | null;
  filename: string;
  expectedFilename: string;
  expiresAt: string | null;
}

export type CatalogSourceHealth = "OK" | "EMPTY" | "NO_ACCESS" | "NO_CATALOG" | "INVALID_CATALOG" | "DISABLED";
export interface CatalogSourceReport {
  folderId: string; folderFound: boolean; catalogFound: boolean; status: CatalogSourceHealth;
  inspection: { entries: number; validBooks: number; withSynopsis: number; validCovers: number; mobiIgnored: number; unsupportedIgnored: number; invalidEntries: number; duplicates: number } | null;
}
/** A catalogue genre: a name and the Google Drive folder that holds its catalog.json. */
export interface CatalogGenreSource { id: string; genre: string; driveFolderUrl: string; folderId: string; enabled: boolean; report: CatalogSourceReport; }
export interface CatalogGenreSourceInput { genre: string; driveFolderUrl: string; enabled?: boolean; }

export interface CatalogSyncReport { lastSyncedAt: string; total: number; created: number; updated: number; duplicates: number; failures: number; unavailable: number; }

export interface CatalogQuery {
  cursor?: string;
  query?: string;
  genreId?: string;
  author?: string;
  format?: "pdf" | "epub";
  collection?: string;
}

/** Browser-facing API. Google credentials are intentionally not part of this class. */
export class CatalogService {
  public constructor(private readonly api: ApiClient) {}

  public async list(query: CatalogQuery = {}): Promise<CatalogPage> {
    const parameters = new URLSearchParams();
    parameters.set("locale", I18nManager.shared.locale);
    Object.entries(query).forEach(([key, value]) => { if (value) parameters.set(key, value); });
    const suffix = parameters.size ? `?${parameters}` : "";
    return this.api.get<CatalogPage>(`/catalog/books${suffix}`);
  }

  public get(bookId: string): Promise<CatalogBookData> {
    return this.api.get<CatalogBookData>(`/catalog/books/${encodeURIComponent(bookId)}?locale=${encodeURIComponent(I18nManager.shared.locale)}`);
  }

  /** The authenticated BFF authorizes the item, then the browser downloads it
   * directly from the public Google Drive URL returned here. */
  public downloadLink(bookId: string): Promise<CatalogDownloadLink> {
    return this.api.get<CatalogDownloadLink>(`/catalog/books/${encodeURIComponent(bookId)}/download?locale=${encodeURIComponent(I18nManager.shared.locale)}`);
  }
  public adminStatus(): Promise<{ isAdmin: boolean }> { return this.api.get("/catalog/admin/status"); }
  public sync(): Promise<CatalogSyncReport> { return this.api.post("/catalog/sync", {}); }
  public async sources(): Promise<readonly CatalogGenreSource[]> { return (await this.api.get<{ sources: CatalogGenreSource[] }>("/catalog/sources")).sources; }
  public createSource(input: CatalogGenreSourceInput): Promise<CatalogGenreSource> { return this.api.post("/catalog/sources", input); }
  public updateSource(id: string, input: Partial<CatalogGenreSourceInput>): Promise<CatalogGenreSource> { return this.api.post(`/catalog/sources/${encodeURIComponent(id)}`, input); }
  public removeSource(id: string): Promise<{ ok: true }> { return this.api.post(`/catalog/sources/${encodeURIComponent(id)}/delete`, {}); }
  /** Reads a folder before it is saved; nothing is stored. */
  public testSource(driveFolderUrl: string, genre?: string): Promise<CatalogSourceReport> { return this.api.post("/catalog/sources/test", { driveFolderUrl, genre }); }
  public testSavedSource(id: string): Promise<CatalogSourceReport> { return this.api.post(`/catalog/sources/${encodeURIComponent(id)}/test`, {}); }
}
