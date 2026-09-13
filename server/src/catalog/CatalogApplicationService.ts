import { ApiError } from "../errors/ApiError.js";
import type { CatalogStore } from "./CatalogRepository.js";
import { CatalogSyncService } from "./CatalogSyncService.js";
import { GoogleCatalogDriveClient } from "./GoogleCatalogDriveClient.js";
import { GoogleDrivePublicUrlResolver, type CatalogDownloadLinkProvider } from "./GoogleDrivePublicUrlResolver.js";
import { HybridCatalogSourceProvider } from "./HybridCatalogSourceProvider.js";
import type { CatalogBookRecord, CatalogDownloadLink, CatalogPage, CatalogQuery, CatalogSyncReport } from "./types.js";

export class CatalogApplicationService {
  private readonly urls: CatalogDownloadLinkProvider;
  public constructor(private readonly store: CatalogStore, private readonly createDrive: () => GoogleCatalogDriveClient, private readonly publicCatalog?: HybridCatalogSourceProvider, urls: CatalogDownloadLinkProvider = new GoogleDrivePublicUrlResolver()) { this.urls = urls; }
  public list(query: CatalogQuery): Promise<CatalogPage> { return this.publicCatalog ? this.publicCatalog.list(query) : this.store.list(query); }
  public async get(bookId: string, locale?: string): Promise<CatalogBookRecord> {
    const book = this.publicCatalog ? await this.publicCatalog.get(bookId, locale) : await this.store.getActive(bookId); if (!book) throw new ApiError(404, "CATALOG_BOOK_NOT_FOUND", "Livro não encontrado no catálogo."); return book;
  }
  public async download(bookId: string, locale?: string): Promise<CatalogDownloadLink> {
    const book = await this.get(bookId, locale);
    const info = this.urls.resolve(book.driveFileId, book.format);
    console.info(JSON.stringify({ event: "CATALOG_DOWNLOAD_REQUEST", bookId: book.bookId, driveFileId: info.driveFileId }));
    console.info(JSON.stringify({ event: "CATALOG_DOWNLOAD_INFO", bookId: book.bookId, driveFileId: info.driveFileId, downloadUrl: info.downloadUrl, expectedFormat: info.expectedFormat }));
    return {
      bookId: book.bookId,
      driveFileId: info.driveFileId,
      resourceKey: book.resourceKey ?? null,
      downloadUrl: info.downloadUrl,
      downloadUrls: info.downloadUrls,
      title: book.title,
      author: book.author,
      genreId: book.genreId,
      genreName: book.genreName,
      format: book.format,
      sha256: book.sha256,
      coverUrl: book.coverUrl ?? info.coverUrl,
      fileSize: book.fileSize,
      filename: `${book.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "livro"}.${book.format}`,
      // Public Drive links are resolved by the browser; no OAuth token or BFF
      // byte proxy is involved in this catalogue flow.
      expiresAt: null,
    };
  }
  public async sync(userId: string): Promise<CatalogSyncReport> {
    if (!await this.store.isAdmin(userId)) throw new ApiError(403, "CATALOG_ADMIN_REQUIRED", "Esta conta não pode sincronizar o catálogo.");
    return new CatalogSyncService(this.store, this.createDrive()).sync();
  }
  public async adminStatus(userId: string): Promise<{ isAdmin: boolean; sources?: readonly import("./types.js").CatalogSourceDiagnostic[] }> {
    const isAdmin = await this.store.isAdmin(userId);
    return isAdmin && this.publicCatalog ? { isAdmin, sources: await this.publicCatalog.diagnostics() } : { isAdmin };
  }
}
