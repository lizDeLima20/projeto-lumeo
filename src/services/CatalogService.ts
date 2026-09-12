import type { ApiClient } from "./ApiClient";
import type { CatalogBookData, CatalogPage } from "../models/CatalogBook";

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
}

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
    Object.entries(query).forEach(([key, value]) => { if (value) parameters.set(key, value); });
    const suffix = parameters.size ? `?${parameters}` : "";
    return this.api.get<CatalogPage>(`/catalog/books${suffix}`);
  }

  public get(bookId: string): Promise<CatalogBookData> {
    return this.api.get<CatalogBookData>(`/catalog/books/${encodeURIComponent(bookId)}`);
  }

  /** The authenticated BFF authorizes the item, then the browser downloads it
   * directly from the public Google Drive URL returned here. */
  public downloadLink(bookId: string): Promise<CatalogDownloadLink> {
    return this.api.get<CatalogDownloadLink>(`/catalog/books/${encodeURIComponent(bookId)}/download`);
  }
  public adminStatus(): Promise<{ isAdmin: boolean }> { return this.api.get("/catalog/admin/status"); }
  public sync(): Promise<CatalogSyncReport> { return this.api.post("/catalog/sync", {}); }
}
