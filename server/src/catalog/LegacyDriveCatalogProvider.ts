import { GoogleDrivePublicUrlResolver } from "./GoogleDrivePublicUrlResolver.js";
import { PublicDriveFolderReader } from "./PublicDriveFolderReader.js";
import type { CatalogSourceProvider } from "./CatalogSourceProvider.js";
import type { CatalogBookRecord, CatalogPage, CatalogQuery, CatalogSourceConfig, CatalogSourceDiagnostic } from "./types.js";

/** Existing public-folder flow. It deliberately has no catalog.json requirement. */
export class LegacyDriveCatalogProvider implements CatalogSourceProvider {
  public readonly provider = "legacy" as const;
  private cache: { expiresAt: number; books: readonly CatalogBookRecord[] } | null = null;
  private readonly urls = new GoogleDrivePublicUrlResolver();
  public constructor(public readonly source: CatalogSourceConfig, private readonly folder = new PublicDriveFolderReader()) {}

  public async list(query: CatalogQuery): Promise<CatalogPage> {
    const values = (await this.books()).filter((book) => this.matches(book, query));
    const page = values.slice(query.offset, query.offset + query.limit + 1);
    return { items: page.slice(0, query.limit), nextCursor: page.length > query.limit ? String(query.offset + query.limit) : null };
  }
  public async get(bookId: string): Promise<CatalogBookRecord | null> { return (await this.books()).find((book) => book.bookId === bookId) ?? null; }
  public diagnostic(): CatalogSourceDiagnostic { return { sourceId: this.source.sourceId, locale: this.source.locale, mode: "legacy", provider: this.provider }; }

  private async books(): Promise<readonly CatalogBookRecord[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.books;
    const now = new Date().toISOString();
    const books = (await this.folder.files(this.source.folderId)).flatMap((file): CatalogBookRecord[] => {
      const format = this.format(file.name); if (!format) return [];
      const parsed = this.parseName(file.name), publicInfo = this.urls.resolve(file.fileId, format);
      return [{ bookId: file.fileId, title: parsed.title, author: parsed.author, genreId: "sem-genero", genreName: "Sem gênero", coverUrl: publicInfo.coverUrl,
        description: null, format, fileSize: null, driveFileId: file.fileId, storageAccountId: `google-drive-${this.source.sourceId}`, sha256: null,
        volume: null, collection: null, language: this.source.locale, createdAt: now, updatedAt: now, status: "ACTIVE" }];
    });
    this.cache = { expiresAt: Date.now() + 5 * 60_000, books };
    console.info(JSON.stringify({ event: "LEGACY_CATALOG_LOADED", sourceId: this.source.sourceId, locale: this.source.locale, count: books.length }));
    return books;
  }
  private matches(book: CatalogBookRecord, query: CatalogQuery): boolean {
    if (query.genreId && book.genreId !== query.genreId) return false;
    if (!query.query) return true;
    const needle = query.query.toLocaleLowerCase(this.source.locale); return [book.title, book.author, book.genreName].some((value) => value.toLocaleLowerCase(this.source.locale).includes(needle));
  }
  private format(name: string): "pdf" | "epub" | null { const extension = name.split(".").pop()?.toLowerCase(); return extension === "pdf" || extension === "epub" ? extension : null; }
  private parseName(name: string): { title: string; author: string } {
    const base = name.replace(/\.(pdf|epub)$/i, "").replace(/[_]+/g, " ").trim(), parts = base.split(/\s+-\s+/);
    return { title: (parts[0] || "Livro sem título").trim(), author: (parts.slice(1).join(" - ") || "Autor não informado").trim() };
  }
}
