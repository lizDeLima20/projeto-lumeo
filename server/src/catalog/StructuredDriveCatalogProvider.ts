import { ApiError } from "../errors/ApiError.js";
import { catalogGenreId } from "./CatalogGenreSources.js";
import { GoogleDrivePublicUrlResolver } from "./GoogleDrivePublicUrlResolver.js";
import { PublicDriveFolderReader } from "./PublicDriveFolderReader.js";
import type { CatalogSourceProvider } from "./CatalogSourceProvider.js";
import type { CatalogBookRecord, CatalogPage, CatalogQuery, CatalogSourceConfig, CatalogSourceDiagnostic, CatalogFormat } from "./types.js";

interface StructuredBook {
  bookId?: unknown; title?: unknown; author?: unknown; genre?: unknown; genreName?: unknown; format?: unknown;
  bookDriveFileId?: unknown; driveFileId?: unknown; downloadUrl?: unknown; coverDriveFileId?: unknown; coverUrl?: unknown;
  sha256?: unknown; fileSize?: unknown; description?: unknown; synopsis?: unknown; summary?: unknown;
  volume?: unknown; collection?: unknown; language?: unknown; resourceKey?: unknown; sourceFileName?: unknown;
}
interface StructuredDocument { version?: unknown; locale?: unknown; books?: unknown; }

/** What a catalog.json yielded: the numbers the admin screen shows when a folder is tested. */
export interface CatalogSourceInspection {
  entries: number; validBooks: number; withSynopsis: number; validCovers: number;
  mobiIgnored: number; unsupportedIgnored: number; invalidEntries: number; duplicates: number;
}

/** Reads a folder's catalog.json. Returns null when the folder has none. */
export interface CatalogJsonReader { read(folderId: string): Promise<unknown | null>; }

/** Anonymous access: the public folder listing locates catalog.json, Drive serves it. */
export class PublicCatalogJsonReader implements CatalogJsonReader {
  private readonly urls = new GoogleDrivePublicUrlResolver();
  public constructor(private readonly folder = new PublicDriveFolderReader(), private readonly fetcher: typeof fetch = fetch) {}
  public async read(folderId: string): Promise<unknown | null> {
    const catalogId = (await this.folder.files(folderId)).find((file) => file.name.toLocaleLowerCase("en-US") === "catalog.json")?.fileId;
    if (!catalogId) return null;
    const response = await this.fetcher(this.urls.resolve(catalogId, "pdf").downloadUrl, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new ApiError(503, "CATALOG_SOURCE_UNAVAILABLE", "Não foi possível ler o catálogo estruturado.");
    try { return await response.json() as unknown; } catch { throw new ApiError(422, "CATALOG_SOURCE_INVALID", "catalog.json não possui JSON válido."); }
  }
}

/** Controlled Drive source described by a catalog.json. Book and cover bytes stay in Drive. */
export class StructuredDriveCatalogProvider implements CatalogSourceProvider {
  public readonly provider = "structured" as const;
  private cache: { expiresAt: number; books: readonly CatalogBookRecord[]; inspection: CatalogSourceInspection } | null = null;
  private readonly urls = new GoogleDrivePublicUrlResolver();
  private readonly catalog: CatalogJsonReader;
  public constructor(public readonly source: CatalogSourceConfig, folder = new PublicDriveFolderReader(), fetcher: typeof fetch = fetch, catalog?: CatalogJsonReader) {
    this.catalog = catalog ?? new PublicCatalogJsonReader(folder, fetcher);
  }

  public async hasCatalog(): Promise<boolean> { return (await this.catalog.read(this.source.folderId)) !== null; }
  public async list(query: CatalogQuery): Promise<CatalogPage> {
    const values = (await this.books()).filter((book) => this.matches(book, query));
    const page = values.slice(query.offset, query.offset + query.limit + 1);
    return { items: page.slice(0, query.limit), nextCursor: page.length > query.limit ? String(query.offset + query.limit) : null };
  }
  public async get(bookId: string): Promise<CatalogBookRecord | null> { return (await this.books()).find((book) => book.bookId === bookId) ?? null; }
  public async inspect(): Promise<CatalogSourceInspection> { await this.books(); return this.cache!.inspection; }
  public diagnostic(): CatalogSourceDiagnostic { return { sourceId: this.source.sourceId, locale: this.source.locale, mode: "structured", provider: this.provider }; }

  private async books(): Promise<readonly CatalogBookRecord[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.books;
    const document = await this.catalog.read(this.source.folderId);
    if (document === null) throw new ApiError(404, "CATALOG_JSON_NOT_FOUND", "A pasta não possui catalog.json.");
    // Genre folders publish a bare array; the first structured sources wrap it in { books }.
    const entries = Array.isArray(document) ? document : (document as StructuredDocument | null)?.books;
    if (!Array.isArray(entries)) throw new ApiError(422, "CATALOG_SOURCE_INVALID", "catalog.json não possui livros válidos.");
    const now = new Date().toISOString(), seen = new Set<string>();
    const inspection: CatalogSourceInspection = { entries: entries.length, validBooks: 0, withSynopsis: 0, validCovers: 0, mobiIgnored: 0, unsupportedIgnored: 0, invalidEntries: 0, duplicates: 0 };
    const books = entries.flatMap((entry): CatalogBookRecord[] => {
      const value = (entry && typeof entry === "object" ? entry : {}) as StructuredBook;
      const book = this.record(value, now);
      if (!book) {
        // Only EPUB and PDF have a reader. Other formats are counted, never shown.
        const format = this.string(value.format)?.toLowerCase();
        if (format === "mobi") inspection.mobiIgnored++;
        else if (format && format !== "pdf" && format !== "epub") inspection.unsupportedIgnored++;
        else inspection.invalidEntries++;
        return [];
      }
      if (seen.has(book.bookId)) { inspection.duplicates++; return []; }
      seen.add(book.bookId);
      if (book.description) inspection.withSynopsis++;
      if (this.httpsUrl(value.coverUrl) || this.string(value.coverDriveFileId)) inspection.validCovers++;
      return [book];
    });
    inspection.validBooks = books.length;
    this.cache = { expiresAt: Date.now() + 5 * 60_000, books, inspection };
    console.info(JSON.stringify({ event: "STRUCTURED_CATALOG_LOADED", sourceId: this.source.sourceId, locale: this.source.locale, count: books.length, mobiIgnored: inspection.mobiIgnored, unsupportedIgnored: inspection.unsupportedIgnored, invalidEntries: inspection.invalidEntries, duplicates: inspection.duplicates }));
    return books;
  }

  private record(value: StructuredBook, now: string): CatalogBookRecord | null {
    // Only formats the reader already opens; any other entry (e.g. mobi) is skipped.
    const format = this.format(value.format), driveFileId = this.string(value.bookDriveFileId) ?? this.string(value.driveFileId);
    if (!format || !driveFileId) return null;
    const coverId = this.string(value.coverDriveFileId), rawId = this.string(value.bookId) ?? `${this.source.sourceId}:${driveFileId}`;
    // The catalogue's own cover image comes first, never Drive's automatic preview of the book.
    const coverUrl = this.httpsUrl(value.coverUrl) ?? (coverId ? this.urls.coverUrl(coverId) : this.urls.resolve(driveFileId, format).coverUrl);
    const genre = this.source.genre ?? this.string(value.genre) ?? "sem-genero";
    const genreId = this.source.genre ? catalogGenreId(this.source.genre) : genre;
    const genreName = this.source.genre ?? this.string(value.genreName) ?? this.genreName(genre);
    // Genre catalogues carry `synopsis` (with `summary` kept for compatibility); their
    // `description` is raw file metadata. Older catalogues used `description` itself.
    const description = "synopsis" in value || "summary" in value ? this.text(value.synopsis) ?? this.text(value.summary) : this.text(value.description);
    return { bookId: rawId, title: this.string(value.title) ?? "Livro sem título", author: this.string(value.author) ?? "Autor não informado",
      genreId, genreName, coverUrl, description, format, sourceFileName: this.string(value.sourceFileName),
      fileSize: this.number(value.fileSize), driveFileId, downloadUrl: this.driveDownloadUrl(value.downloadUrl), resourceKey: this.string(value.resourceKey), storageAccountId: `google-drive-${this.source.sourceId}`, sha256: this.sha(value.sha256),
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
  private text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim().slice(0, 5000) : null; }
  private httpsUrl(value: unknown): string | null {
    const raw = typeof value === "string" ? value.trim() : "";
    try { const url = new URL(raw); return url.protocol === "https:" ? url.toString() : null; } catch { return null; }
  }
  /** Book bytes go from Google Drive straight to the browser, so only Drive hosts are accepted. */
  private driveDownloadUrl(value: unknown): string | null {
    const url = this.httpsUrl(value);
    if (!url) return null;
    const host = new URL(url).hostname;
    return host === "drive.google.com" || host === "drive.usercontent.google.com" || host === "docs.google.com" ? url : null;
  }
  private number(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null; }
  private sha(value: unknown): string | null { const item = this.string(value); return item && /^[a-f0-9]{64}$/i.test(item) ? item.toLowerCase() : null; }
  private genreName(genre: string): string { return genre === "sem-genero" ? "Sem gênero" : genre.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toLocaleUpperCase(this.source.locale)); }
}
