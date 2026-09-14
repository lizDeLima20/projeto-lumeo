import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CatalogSourceRegistry } from "../src/catalog/CatalogSourceRegistry.js";
import { HybridCatalogSourceProvider } from "../src/catalog/HybridCatalogSourceProvider.js";
import { LegacyDriveCatalogProvider } from "../src/catalog/LegacyDriveCatalogProvider.js";
import { PublicDriveFolderReader } from "../src/catalog/PublicDriveFolderReader.js";
import { StructuredDriveCatalogProvider } from "../src/catalog/StructuredDriveCatalogProvider.js";
import type { CatalogSourceProvider } from "../src/catalog/CatalogSourceProvider.js";
import type { CatalogBookRecord, CatalogPage, CatalogQuery, CatalogSourceConfig } from "../src/catalog/types.js";

const source = (sourceId: string, locale = "pt-BR", mode: CatalogSourceConfig["mode"] = "auto"): CatalogSourceConfig => ({ sourceId, locale, folderId: "folder-id-123", mode, enabled: true, priority: 10 });
const book = (bookId: string, driveFileId: string, sha256: string | null = null): CatalogBookRecord => ({ bookId, title: `Livro ${bookId}`, author: "Autora", genreId: "sem-genero", genreName: "Sem gênero", coverUrl: null, description: null, format: "pdf", fileSize: null, driveFileId, storageAccountId: "test", sha256, volume: null, collection: null, language: "pt-BR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", status: "ACTIVE" });

class MemoryProvider implements CatalogSourceProvider {
  public readonly provider: "legacy" | "structured";
  public constructor(public readonly source: CatalogSourceConfig, private readonly records: readonly CatalogBookRecord[], kind: "legacy" | "structured" = "legacy", private readonly failure = false) { this.provider = kind; }
  public async list(_query: CatalogQuery): Promise<CatalogPage> { if (this.failure) throw new Error("SOURCE_DOWN"); return { items: this.records, nextCursor: null }; }
  public async get(bookId: string): Promise<CatalogBookRecord | null> { if (this.failure) throw new Error("SOURCE_DOWN"); return this.records.find((item) => item.bookId === bookId) ?? null; }
  public diagnostic() { return { sourceId: this.source.sourceId, locale: this.source.locale, mode: this.provider, provider: this.provider }; }
}

class PagedMemoryProvider extends MemoryProvider {
  public override async list(query: CatalogQuery): Promise<CatalogPage> {
    const all = await super.list(query);
    const start = query.offset;
    const page = all.items.slice(start, start + query.limit + 1);
    return { items: page.slice(0, query.limit), nextCursor: page.length > query.limit ? String(start + query.limit) : null };
  }
}

describe("hybrid catalog sources", () => {
  it("detects catalog.json sources as structured and missing files as legacy", async () => {
    const structured = new MemoryProvider(source("structured"), [], "structured") as MemoryProvider & { hasCatalog(): Promise<boolean> };
    structured.hasCatalog = async () => true;
    const absent = new MemoryProvider(source("legacy"), []) as MemoryProvider & { hasCatalog(): Promise<boolean> };
    absent.hasCatalog = async () => false;
    const registry = new CatalogSourceRegistry([source("structured"), source("legacy")], {
      legacy: (item) => new MemoryProvider(item, [], "legacy"),
      structured: (item) => item.sourceId === "structured" ? structured : absent,
    });
    assert.deepEqual((await registry.providers("pt-BR")).map((provider) => provider.provider), ["legacy", "structured"]);
  });

  it("aggregates locale sources, removes sha duplicates, and isolates a failed source", async () => {
    const ptOne = new MemoryProvider(source("pt-one"), [book("one", "file-one", "a".repeat(64))]);
    const ptDuplicate = new MemoryProvider(source("pt-two"), [book("duplicate", "file-two", "a".repeat(64))], "structured");
    const ptFailure = new MemoryProvider(source("pt-fail"), [], "legacy", true);
    const english = new MemoryProvider(source("en-one", "en-US"), [book("english", "file-en")]);
    const hybrid = new HybridCatalogSourceProvider(async (locale) => [ptOne, ptDuplicate, ptFailure, english].filter((provider) => !locale || provider.source.locale === locale));
    const portuguese = await hybrid.list({ offset: 0, limit: 24, locale: "pt-BR" });
    assert.deepEqual(portuguese.items.map((item) => item.bookId), ["one"]);
    const englishPage = await hybrid.list({ offset: 0, limit: 24, locale: "en-US" });
    assert.deepEqual(englishPage.items.map((item) => item.bookId), ["english"]);
  });

  it("keeps legacy PDF previews and uses a separate structured cover", async () => {
    const folder = new PublicDriveFolderReader(async () => new Response('<tr data-id="pdf-file-123" aria-label="Legacy - Autora.pdf PDF Shared"></tr>'));
    const legacy = new LegacyDriveCatalogProvider(source("legacy", "pt-BR", "legacy"), folder);
    const legacyBook = (await legacy.list({ offset: 0, limit: 24 })).items[0]!;
    assert.match(legacyBook.coverUrl ?? "", /id=pdf-file-123/);

    const structuredFolder = new PublicDriveFolderReader(async () => new Response('<tr data-id="catalog-file-123" aria-label="catalog.json JSON Shared"></tr>'));
    const structured = new StructuredDriveCatalogProvider(source("controlled", "pt-BR", "structured"), structuredFolder, async () => new Response(JSON.stringify({ version: 1, locale: "pt-BR", books: [{ bookId: "structured-book", title: "EPUB", author: "Autora", genre: "romance", format: "epub", bookDriveFileId: "epub-file-123", coverDriveFileId: "cover-file-123" }] })));
    const structuredBook = (await structured.list({ offset: 0, limit: 24 })).items[0]!;
    assert.match(structuredBook.coverUrl ?? "", /id=cover-file-123/);
  });

  it("searches and paginates beyond the former 500-record source cap", async () => {
    const values = Array.from({ length: 1_501 }, (_, index) => book(`catalog-${index}`, `drive-${index}`));
    const provider = new PagedMemoryProvider(source("large"), values);
    const hybrid = new HybridCatalogSourceProvider(async () => [provider]);

    const result = await hybrid.list({ offset: 0, limit: 24, query: "catalog-1500" });
    assert.deepEqual(result.items.map((item) => item.bookId), ["catalog-1500"]);
  });
});
