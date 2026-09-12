import { ApiError } from "../errors/ApiError.js";
import type { CatalogStore } from "./CatalogRepository.js";
import { CatalogSyncService } from "./CatalogSyncService.js";
import { GoogleCatalogDriveClient, type CatalogDriveFile } from "./GoogleCatalogDriveClient.js";
import type { CatalogBookRecord, CatalogDownload, CatalogPage, CatalogQuery, CatalogSyncReport } from "./types.js";

export class CatalogApplicationService {
  public constructor(private readonly store: CatalogStore, private readonly createDrive: () => GoogleCatalogDriveClient) {}
  public list(query: CatalogQuery): Promise<CatalogPage> { return this.store.list(query); }
  public async get(bookId: string): Promise<CatalogBookRecord> {
    const book = await this.store.getActive(bookId); if (!book) throw new ApiError(404, "CATALOG_BOOK_NOT_FOUND", "Livro não encontrado no catálogo."); return book;
  }
  public async download(bookId: string): Promise<CatalogDownload> {
    const book = await this.get(bookId);
    const file: CatalogDriveFile = { id: book.driveFileId, name: `${book.title}.${book.format}`, format: book.format, mimeType: book.format === "pdf" ? "application/pdf" : "application/epub+zip", size: book.fileSize, modifiedAt: book.updatedAt };
    return this.createDrive().download(file);
  }
  public async sync(userId: string): Promise<CatalogSyncReport> {
    if (!await this.store.isAdmin(userId)) throw new ApiError(403, "CATALOG_ADMIN_REQUIRED", "Esta conta não pode sincronizar o catálogo.");
    return new CatalogSyncService(this.store, this.createDrive()).sync();
  }
  public async adminStatus(userId: string): Promise<{ isAdmin: boolean }> { return { isAdmin: await this.store.isAdmin(userId) }; }
}
