import { ApiError } from "../errors/ApiError.js";
import { GoogleDrivePublicUrlResolver } from "./GoogleDrivePublicUrlResolver.js";
import { PublicDriveFolderReader } from "./PublicDriveFolderReader.js";
import type { CatalogSourceProvider } from "./CatalogSourceProvider.js";
import type { CatalogBookRecord, CatalogPage, CatalogQuery, CatalogSourceConfig, CatalogSourceDiagnostic, CatalogFormat } from "./types.js";

interface StructuredBook {
  bookId?: unknown; title?: unknown; author?: unknown; genre?: unknown; genreName?: unknown; format?: unknown;
  bookDriveFileId?: unknown; coverDriveFileId?: unknown; sha256?: unknown; fileSize?: unknown; description?: unknown;
  volume?: unknown; collection?: unknown; language?: unknown; resourceKey?: unknown;
}
interface StructuredDocument { version?: unknown; locale?: unknown; books?: unknown; }

/** Controlled Drive source with lightweight catalog.json and separate cover IDs. */
export class StructuredDriveCatalogProvider implements CatalogSourceProvider {
  public readonly provider = "structured" as const;
  private cache: { expiresAt: number; books: readonly CatalogBookRecord[] } | null = null;
  private readonly urls = new GoogleDrivePublicUrlResolver();
  public constructor(public readonly source: CatalogSourceConfig, private readonly folder = new PublicDriveFolderReader(), private readonly fetcher: typeof fetch = fetch) {}

  public async hasCatalog(): Promise<boolean> { return Boolean(await this.catalogFileId()); }
  public async list(query: CatalogQuery): Promise<CatalogPage> {
    const values = (await this.books()).filter((book) => this.matches(book, query));
    const page = values.slice(query.offset, query.offset + query.limit + 1);
    return { items: page.slice(0, query.limit), nextCursor: page.length > query.limit ? String(query.offset + query.limit) : null };
  }
  public async get(bookId: string): Promise<CatalogBookRecord | null> { return (await this.books()).find((book) => book.bookId === bookId) ?? null; }
  public diagnostic(): CatalogSourceDiagnostic { return { sourceId: this.source.sourceId, locale: this.source.locale, mode: "structured", provider: this.provider }; }

  private async books(): Promise<readonly CatalogBookRecord[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.books;
    const catalogId = await this.catalogFileId();
    if (!catalogId) throw new ApiError(503, "CATALOG_SOURCE_UNAVAILABLE", "A fonte estruturada não possui catalog.json público.");
    const response = await this.fetcher(this.urls.resolve(catalogId, "pdf").downloadUrl, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new ApiError(503, "CATALOG_SOURCE_UNAVAILABLE", "Não foi possível ler o catálogo estruturado.");
    let document: StructuredDocument;
    try { document = await response.json() as StructuredDocument; } catch { throw new ApiError(422, "CATALOG_SOURCE_INVALID", "catalog.json não possui JSON válido."); }
    if (!Array.isArray(document.books)) throw new ApiError(422, "CATALOG_SOURCE_INVALID", "catalog.json não possui livros válidos.");
    const now = new Date().toISOString(), seen = new Set<string>();
    const books = document.books.flatMap((entry): CatalogBookRecord[] => {
      const book = this.record(entry as StructuredBook, now); if (!book || seen.has(book.bookId)) return []; seen.add(book.bookId); return [book];
    });
    this.cache = { expiresAt: Date.now() + 5 * 60_000, books };
    console.info(JSON.stringify({ event: "STRUCTURED_CATALOG_LOADED", sourceId: this.source.sourceId, locale: this.source.locale, count: books.length }));
    return books;
  }

  private async catalogFileId(): Promise<string | null> {
    const values = await this.folder.files(this.source.folderId);
    return values.find((file) => file.name.toLocaleLowerCase("en-US") === "catalog.json")?.fileId ?? null;
  }
  private record(value: StructuredBook, now: string): CatalogBookRecord | null {
    const format = this.format(value.format), driveFileId = this.string(value.bookDriveFileId);
    if (!format || !driveFileId) return null;
    const coverId = this.string(value.coverDriveFileId), rawId = this.string(value.bookId) ?? `${this.source.sourceId}:${driveFileId}`;
    const coverUrl = coverId ? this.urls.coverUrl(coverId) : this.urls.resolve(driveFileId, format).coverUrl;
    const genre = this.string(value.genre) ?? "sem-genero";
    return { bookId: rawId, title: this.string(value.title) ?? "Livro sem título", author: this.string(value.author) ?? "Autor não informado",
      genreId: genre, genreName: this.string(value.genreName) ?? this.genreName(genre), coverUrl, description: this.string(value.description), format,
      fileSize: this.number(value.fileSize), driveFileId, resourceKey: this.string(value.resourceKey), storageAccountId: `google-drive-${this.source.sourceId}`, sha256: this.sha(value.sha256),
      volume: this.string(value.volume), collection: this.string(value.collection), language: this.string(value.language) ?? this.source.locale,
      createdAt: now, updatedAt: now, status: "ACTIVE" };
  }
  private matches(book: CatalogBookRecord, query: CatalogQuery): boolean {
    if (query.genreId && book.genreId !== query.genreId) return false;
    if (!query.query) return true;
    const needle = query.query.toLocaleLowerCase(this.source.locale); return [book.title, book.author, book.genreName, book.collection ?? ""].some((value) => value.toLocaleLowerCase(this.source.locale).includes(needle));
  }
  private format(value: unknown): CatalogFormat | null { const normalized = this.string(value)?.toLowerCase(); return normalized === "pdf" || normalized === "epub" ? normalized : null; }
  private string(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null; }
  private number(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null; }
  private sha(value: unknown): string | null { const item = this.string(value); return item && /^[a-f0-9]{64}$/i.test(item) ? item.toLowerCase() : null; }
  private genreName(genre: string): string { return genre === "sem-genero" ? "Sem gênero" : genre.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toLocaleUpperCase(this.source.locale)); }
}
