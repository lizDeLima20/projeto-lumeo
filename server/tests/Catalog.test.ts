import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CatalogApplicationService } from "../src/catalog/CatalogApplicationService.js";
import type { CatalogStore } from "../src/catalog/CatalogRepository.js";
import type { CatalogBookRecord, CatalogPage, CatalogQuery } from "../src/catalog/types.js";
import { ApiError } from "../src/errors/ApiError.js";

const item = (bookId = "10000000-0000-4000-8000-000000000001"): CatalogBookRecord => ({ bookId, title: "Livro autorizado", author: "Autora", genreId: "romance", genreName: "Romance", coverUrl: null, description: null, format: "epub", fileSize: 42, driveFileId: "drive-file", storageAccountId: "google-drive-default", sha256: "a".repeat(64), volume: null, collection: null, language: "pt-BR", createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z", status: "ACTIVE" });

class MemoryCatalogStore implements CatalogStore {
  public readonly rows = new Map<string, CatalogBookRecord>(); public admin = false;
  public async list(query: CatalogQuery): Promise<CatalogPage> { const values = [...this.rows.values()].filter((row) => row.status === "ACTIVE" && (!query.genreId || row.genreId === query.genreId)); const page = values.slice(query.offset, query.offset + query.limit + 1); return { items: page.slice(0, query.limit), nextCursor: page.length > query.limit ? String(query.offset + query.limit) : null }; }
  public async getActive(bookId: string): Promise<CatalogBookRecord | null> { const value = this.rows.get(bookId); return value?.status === "ACTIVE" ? value : null; }
  public async getAnyByDriveFileId(_storageAccountId: string, driveFileId: string): Promise<CatalogBookRecord | null> { return [...this.rows.values()].find((value) => value.driveFileId === driveFileId) ?? null; }
  public async getAnyBySha256(sha256: string): Promise<CatalogBookRecord | null> { return [...this.rows.values()].find((value) => value.sha256 === sha256) ?? null; }
  public async save(book: CatalogBookRecord): Promise<void> { this.rows.set(book.bookId, book); }
  public async markUnavailableMissingFrom(): Promise<number> { return 0; }
  public async isAdmin(): Promise<boolean> { return this.admin; }
}

describe("CatalogApplicationService", () => {
  it("lists only active records with pagination", async () => {
    const store = new MemoryCatalogStore(); await store.save(item()); await store.save(item("10000000-0000-4000-8000-000000000002"));
    const service = new CatalogApplicationService(store, () => driveStub()); const page = await service.list({ offset: 0, limit: 1 });
    assert.equal(page.items.length, 1); assert.equal(page.nextCursor, "1");
  });
  it("never returns an unavailable record as a downloadable book", async () => {
    const store = new MemoryCatalogStore(); await store.save({ ...item(), status: "UNAVAILABLE" }); const service = new CatalogApplicationService(store, () => driveStub());
    await assert.rejects(() => service.download(item().bookId), (error: unknown) => error instanceof ApiError && error.code === "CATALOG_BOOK_NOT_FOUND");
  });
  it("returns a public Drive URL and never a file stream", async () => {
    const store = new MemoryCatalogStore(); await store.save(item());
    const download = await new CatalogApplicationService(store, () => driveStub()).download(item().bookId);
    assert.equal(download.bookId, item().bookId);
    assert.match(download.downloadUrl, /^https:\/\/drive\.usercontent\.google\.com\/download\?/);
    assert.equal("body" in download, false);
  });
  it("requires a backend-admin decision before synchronization", async () => {
    const store = new MemoryCatalogStore(); const service = new CatalogApplicationService(store, () => driveStub());
    await assert.rejects(() => service.sync("user"), (error: unknown) => error instanceof ApiError && error.code === "CATALOG_ADMIN_REQUIRED");
  });
});

function driveStub(): never {
  return {} as never;
}
