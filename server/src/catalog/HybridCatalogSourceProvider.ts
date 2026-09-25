import type { CatalogSourceProvider } from "./CatalogSourceProvider.js";
import type { CatalogBookRecord, CatalogGenre, CatalogPage, CatalogQuery, CatalogSourceDiagnostic } from "./types.js";
import { matchesCatalogText } from "../../../shared/CatalogTextSearch.js";

/** Aggregates independent public sources without exposing their account/provider to readers. */
export class HybridCatalogSourceProvider {
  private readonly providersByBookId = new Map<string, CatalogSourceProvider>();
  public constructor(private readonly sources: (locale?: string) => Promise<readonly CatalogSourceProvider[]>) {}

  public async list(query: CatalogQuery): Promise<CatalogPage> {
    const providers = await this.sources(query.locale);
    // A source can contain thousands of books. Fetch every provider page before
    // deduplicating so a UI-sized page never becomes a catalogue-sized limit.
    const pages = await Promise.allSettled(providers.map((provider) => this.allProviderItems(provider, query)));
    const books: CatalogBookRecord[] = [], seen = new Set<string>(); this.providersByBookId.clear();
    const sourceCounts: Array<{ sourceId: string; items: number; pages: number; failed: boolean }> = [];
    pages.forEach((result, index) => {
      const provider = providers[index]!;
      if (result.status === "rejected") {
        console.warn(JSON.stringify({ event: "CATALOG_SOURCE_FAILED", sourceId: provider.source.sourceId, locale: provider.source.locale, provider: provider.provider, code: HybridCatalogSourceProvider.errorCode(result.reason) }));
        console.warn(JSON.stringify({ event: "CATALOG_CATEGORY_INVALID", sourceId: provider.source.sourceId, genre: provider.source.genre, reason: "CATALOG_READ_FAILED" }));
        sourceCounts.push({ sourceId: provider.source.sourceId, items: 0, pages: 0, failed: true });
        return;
      }
      sourceCounts.push({ sourceId: provider.source.sourceId, items: result.value.items.length, pages: result.value.pages, failed: false });
      if (provider.source.genre && result.value.items.length > 0) console.info(JSON.stringify({ event: "CATALOG_CATEGORY_VALID", sourceId: provider.source.sourceId, genre: provider.source.genre, books: result.value.items.length }));
      if (provider.source.genre && result.value.items.length === 0) console.warn(JSON.stringify({ event: "CATALOG_CATEGORY_INVALID", sourceId: provider.source.sourceId, genre: provider.source.genre, reason: "NO_VALID_BOOKS" }));
      for (const book of result.value.items) {
        // A book belongs to every genre whose catalogue lists it: the same content in two
        // genre folders is two memberships, not a duplicate. Only repeats inside one genre drop.
        const identity = `${book.genreId}|${HybridCatalogSourceProvider.contentIdentity(book, provider)}`;
        if (seen.has(identity)) continue;
        seen.add(identity); books.push(book);
        if (!this.providersByBookId.has(book.bookId)) this.providersByBookId.set(book.bookId, provider);
      }
    });
    if (providers.length > 0 && pages.every((result) => result.status === "rejected")) throw new Error(`CATALOG_ALL_SOURCES_FAILED:${HybridCatalogSourceProvider.errorCode((pages[0] as PromiseRejectedResult).reason)}`);
    // Without a genre filter each book is listed once, under the first genre that lists it.
    const shown = new Set<string>();
    const filtered = books.filter((book) => this.matches(book, query)).filter((book) => {
      if (query.genreId) return true;
      const identity = HybridCatalogSourceProvider.contentIdentity(book, this.providersByBookId.get(book.bookId));
      if (shown.has(identity) || shown.has(`id:${book.bookId}`)) return false;
      shown.add(identity); shown.add(`id:${book.bookId}`); return true;
    });
    const page = filtered.slice(query.offset, query.offset + query.limit + 1);
    console.info(JSON.stringify({ event: "CATALOG_PIPELINE_COUNTS", sourceCounts, totalFoundInSources: sourceCounts.reduce((total, source) => total + source.items, 0), afterDeduplication: books.length, afterFilters: filtered.length, returnedByApi: Math.min(query.limit, page.length), requestedOffset: query.offset }));
    return { items: page.slice(0, query.limit), nextCursor: page.length > query.limit ? String(query.offset + query.limit) : null, genres: HybridCatalogSourceProvider.genres(books) };
  }

  private static contentIdentity(book: CatalogBookRecord, provider: CatalogSourceProvider | undefined): string {
    return book.sha256 ? `sha:${book.sha256}` : `drive:${provider?.source.sourceId ?? ""}:${book.driveFileId}`;
  }

  /** Every genre present across the loaded sources, so each can be offered as a filter. */
  private static genres(books: readonly CatalogBookRecord[]): readonly CatalogGenre[] {
    const genres = new Map<string, string>();
    for (const book of books) if (book.genreId && book.genreId !== "sem-genero" && !genres.has(book.genreId)) genres.set(book.genreId, book.genreName);
    return [...genres].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  }

  public async get(bookId: string, locale?: string): Promise<CatalogBookRecord | null> {
    const known = this.providersByBookId.get(bookId);
    if (known) return known.get(bookId);
    const providers = await this.sources(locale);
    const hasExactLocale = !locale || providers.some((provider) => provider.source.locale === locale);
    for (const provider of providers) {
      if (hasExactLocale && locale && provider.source.locale !== locale) continue;
      try { const book = await provider.get(bookId); if (book) { this.providersByBookId.set(bookId, provider); return book; } }
      catch (error) { console.warn(JSON.stringify({ event: "CATALOG_SOURCE_FAILED", sourceId: provider.source.sourceId, locale: provider.source.locale, provider: provider.provider, code: HybridCatalogSourceProvider.errorCode(error) })); }
    }
    return null;
  }

  public async diagnostics(locale?: string): Promise<readonly CatalogSourceDiagnostic[]> {
    const providers = await this.sources(locale);
    const hasExactLocale = !locale || providers.some((provider) => provider.source.locale === locale);
    return providers.filter((provider) => !hasExactLocale || !locale || provider.source.locale === locale).map((provider) => provider.diagnostic());
  }

  private async allProviderItems(provider: CatalogSourceProvider, query: CatalogQuery): Promise<{ items: readonly CatalogBookRecord[]; pages: number }> {
    const items: CatalogBookRecord[] = [];
    const seenCursors = new Set<number>();
    let offset = 0;
    let pages = 0;
    while (true) {
      if (seenCursors.has(offset)) throw new Error("CATALOG_SOURCE_CURSOR_LOOP");
      seenCursors.add(offset);
      // Genre chips describe the full source, even while the reader searches or
      // opens a preselected genre. Apply user filters only after aggregation.
      const page = await provider.list({
        ...query, query: undefined, genreId: undefined, author: undefined,
        collection: undefined, format: undefined, offset, limit: 250,
      });
      pages++;
      items.push(...page.items);
      if (!page.nextCursor) return { items, pages };
      const nextOffset = Number.parseInt(page.nextCursor, 10);
      if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) throw new Error("CATALOG_SOURCE_CURSOR_INVALID");
      offset = nextOffset;
    }
  }

  private matches(book: CatalogBookRecord, query: CatalogQuery): boolean {
    if (query.genreId && book.genreId !== query.genreId) return false;
    if (query.format && book.format !== query.format) return false;
    if (query.author && !book.author.toLocaleLowerCase().includes(query.author.toLocaleLowerCase())) return false;
    if (query.collection && !(book.collection ?? "").toLocaleLowerCase().includes(query.collection.toLocaleLowerCase())) return false;
    if (!query.query) return true;
    return matchesCatalogText(query.query, [book.title, book.author, book.collection, ...(!query.genreId ? [book.genreName] : [])]);
  }
  private static errorCode(error: unknown): string { return error instanceof Error ? error.message.slice(0, 80) : "UNKNOWN"; }
}
