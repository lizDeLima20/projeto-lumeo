import type { CatalogSourceProvider } from "./CatalogSourceProvider.js";
import type { CatalogBookRecord, CatalogPage, CatalogQuery, CatalogSourceDiagnostic } from "./types.js";

/** Aggregates independent public sources without exposing their account/provider to readers. */
export class HybridCatalogSourceProvider {
  private readonly providersByBookId = new Map<string, CatalogSourceProvider>();
  public constructor(private readonly sources: (locale?: string) => Promise<readonly CatalogSourceProvider[]>) {}

  public async list(query: CatalogQuery): Promise<CatalogPage> {
    const providers = await this.sources(query.locale);
    const pages = await Promise.allSettled(providers.map((provider) => provider.list({ ...query, offset: 0, limit: 500 })));
    const books: CatalogBookRecord[] = [], seen = new Set<string>(); this.providersByBookId.clear();
    pages.forEach((result, index) => {
      const provider = providers[index]!;
      if (result.status === "rejected") {
        console.warn(JSON.stringify({ event: "CATALOG_SOURCE_FAILED", sourceId: provider.source.sourceId, locale: provider.source.locale, provider: provider.provider, code: HybridCatalogSourceProvider.errorCode(result.reason) }));
        return;
      }
      for (const book of result.value.items) {
        const identity = book.sha256 ? `sha:${book.sha256}` : `drive:${provider.source.sourceId}:${book.driveFileId}`;
        if (seen.has(identity) || this.providersByBookId.has(book.bookId)) continue;
        seen.add(identity); books.push(book); this.providersByBookId.set(book.bookId, provider);
      }
    });
    const filtered = books.filter((book) => this.matches(book, query));
    const page = filtered.slice(query.offset, query.offset + query.limit + 1);
    return { items: page.slice(0, query.limit), nextCursor: page.length > query.limit ? String(query.offset + query.limit) : null };
  }

  public async get(bookId: string, locale?: string): Promise<CatalogBookRecord | null> {
    const known = this.providersByBookId.get(bookId);
    if (known) return known.get(bookId);
    const providers = await this.sources(locale);
    for (const provider of providers) {
      if (locale && provider.source.locale !== locale) continue;
      try { const book = await provider.get(bookId); if (book) { this.providersByBookId.set(bookId, provider); return book; } }
      catch (error) { console.warn(JSON.stringify({ event: "CATALOG_SOURCE_FAILED", sourceId: provider.source.sourceId, locale: provider.source.locale, provider: provider.provider, code: HybridCatalogSourceProvider.errorCode(error) })); }
    }
    return null;
  }

  public async diagnostics(locale?: string): Promise<readonly CatalogSourceDiagnostic[]> {
    return (await this.sources(locale)).filter((provider) => !locale || provider.source.locale === locale).map((provider) => provider.diagnostic());
  }

  private matches(book: CatalogBookRecord, query: CatalogQuery): boolean {
    if (query.genreId && book.genreId !== query.genreId) return false;
    if (query.format && book.format !== query.format) return false;
    if (query.author && !book.author.toLocaleLowerCase().includes(query.author.toLocaleLowerCase())) return false;
    if (query.collection && !(book.collection ?? "").toLocaleLowerCase().includes(query.collection.toLocaleLowerCase())) return false;
    if (!query.query) return true;
    const needle = query.query.toLocaleLowerCase(); return [book.title, book.author, book.genreName, book.collection ?? ""].some((value) => value.toLocaleLowerCase().includes(needle));
  }
  private static errorCode(error: unknown): string { return error instanceof Error ? error.message.slice(0, 80) : "UNKNOWN"; }
}
