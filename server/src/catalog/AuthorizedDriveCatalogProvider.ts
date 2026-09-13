import { GoogleCatalogDriveClient } from "./GoogleCatalogDriveClient.js";
import { GoogleDrivePublicUrlResolver } from "./GoogleDrivePublicUrlResolver.js";
import type { CatalogSourceProvider } from "./CatalogSourceProvider.js";
import type { CatalogBookRecord, CatalogPage, CatalogQuery, CatalogSourceConfig, CatalogSourceDiagnostic } from "./types.js";

/** Full Drive API provider. Unlike the public HTML reader it visits every API page and subfolder. */
export class AuthorizedDriveCatalogProvider implements CatalogSourceProvider {
  public readonly provider = "authorized" as const;
  private readonly urls = new GoogleDrivePublicUrlResolver();
  private cache: { expiresAt: number; values: readonly CatalogBookRecord[]; audit: import("./types.js").CatalogSourceDiagnostic["audit"] } | null = null;
  public constructor(public readonly source: CatalogSourceConfig, private readonly createDrive: () => GoogleCatalogDriveClient) {}
  public async list(query: CatalogQuery): Promise<CatalogPage> { const values = (await this.records()).filter((book) => this.matches(book, query)); const page = values.slice(query.offset, query.offset + query.limit + 1); return { items: page.slice(0, query.limit), nextCursor: page.length > query.limit ? String(query.offset + query.limit) : null }; }
  public async get(bookId: string): Promise<CatalogBookRecord | null> { return (await this.records()).find((book) => book.bookId === bookId) ?? null; }
  public diagnostic(): CatalogSourceDiagnostic { return { sourceId: this.source.sourceId, locale: this.source.locale, mode: this.provider, provider: this.provider, audit: this.cache?.audit }; }
  private async records(): Promise<readonly CatalogBookRecord[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.values;
    const listing = await this.createDrive().listCatalog(), now = new Date().toISOString();
    const values = listing.books.map((file): CatalogBookRecord => { const parsed = this.parseName(file.name); const info = this.urls.resolve(file.id, file.format); return { bookId: `${this.source.sourceId}:${file.id}`, title: parsed.title, author: parsed.author, genreId: "sem-genero", genreName: "Sem gênero", coverUrl: info.coverUrl, description: null, format: file.format, fileSize: file.size, driveFileId: file.id, resourceKey: file.resourceKey, storageAccountId: `google-drive-${this.source.sourceId}`, sha256: null, volume: parsed.volume, collection: parsed.collection, language: this.source.locale, createdAt: now, updatedAt: file.modifiedAt || now, status: "ACTIVE" }; });
    this.cache = { expiresAt: Date.now() + 5 * 60_000, values, audit: listing.audit }; return values;
  }
  private matches(book: CatalogBookRecord, query: CatalogQuery): boolean { if (query.genreId && book.genreId !== query.genreId) return false; if (query.format && book.format !== query.format) return false; const text = [book.title, book.author, book.genreName, book.collection ?? ""].join(" ").toLowerCase(); return !query.query || text.includes(query.query.toLowerCase()); }
  private parseName(name: string): { title: string; author: string; volume: string | null; collection: string | null } { const base = name.replace(/\.(pdf|epub)$/i, "").replace(/[_]+/g, " ").trim(), parts = base.split(/\s+-\s+/); const title = (parts[0] || "Livro sem título").trim(), author = (parts.slice(1).join(" - ") || "Autor não informado").trim(), volume = base.match(/(?:volume|vol\.?|v\.?|parte|tomo)\s*(\d+)/i)?.[1] ?? null; return { title, author, volume, collection: volume ? title.replace(/\s*(?:volume|vol\.?|v\.?|parte|tomo)\s*\d+.*/i, "").trim() || null : null }; }
}
