import type { CatalogBookRecord, CatalogPage, CatalogQuery } from "./types.js";

/** Reads only the public HTML representation of a shared Drive folder. */
export class PublicGoogleDriveCatalog {
  private cache: { expiresAt: number; books: readonly CatalogBookRecord[] } | null = null;
  public constructor(private readonly folderId: string, private readonly locale = "pt-BR") {}

  public async list(query: CatalogQuery): Promise<CatalogPage> {
    const values = (await this.books()).filter((book) => this.matches(book, query));
    const page = values.slice(query.offset, query.offset + query.limit + 1);
    return { items: page.slice(0, query.limit), nextCursor: page.length > query.limit ? String(query.offset + query.limit) : null };
  }
  public async get(bookId: string): Promise<CatalogBookRecord | null> { return (await this.books()).find((book) => book.bookId === bookId) ?? null; }

  private async books(): Promise<readonly CatalogBookRecord[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.books;
    const response = await fetch(`https://drive.google.com/drive/folders/${encodeURIComponent(this.folderId)}`, { headers: { "User-Agent": "Lumeo catalog public reader" } });
    if (!response.ok) throw new Error("CATALOG_PUBLIC_SOURCE_UNAVAILABLE");
    const html = await response.text(); const rows: CatalogBookRecord[] = []; const seen = new Set<string>();
    const pattern = /<tr[^>]*data-id="([A-Za-z0-9_-]{10,})"[\s\S]*?aria-label="([^"]+?\.(pdf|epub))\s+(?:PDF|EPUB)\s+Shared"/gi;
    for (let match; (match = pattern.exec(html));) {
      const driveFileId = match[1]!; if (seen.has(driveFileId)) continue; seen.add(driveFileId);
      const name = this.decode(match[2]!); const format = match[3]!.toLowerCase() as "pdf" | "epub"; const parsed = this.parseName(name);
      rows.push({ bookId: driveFileId, title: parsed.title, author: parsed.author, genreId: "sem-genero", genreName: "Sem gênero", coverUrl: null, description: null,
        format, fileSize: null, driveFileId, storageAccountId: `google-drive-${this.locale}`, sha256: null, volume: null, collection: null, language: "pt", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "ACTIVE" });
    }
    this.cache = { expiresAt: Date.now() + 5 * 60_000, books: rows }; return rows;
  }
  private matches(book: CatalogBookRecord, query: CatalogQuery): boolean {
    if (query.genreId && book.genreId !== query.genreId) return false;
    if (!query.query) return true;
    const needle = query.query.toLocaleLowerCase("pt-BR"); return [book.title, book.author, book.genreName].some((value) => value.toLocaleLowerCase("pt-BR").includes(needle));
  }
  private parseName(name: string): { title: string; author: string } {
    const base = name.replace(/\.(pdf|epub)$/i, "").replace(/[_]+/g, " ").trim(); const parts = base.split(/\s+-\s+/);
    return { title: (parts[0] || "Livro sem título").trim(), author: (parts.slice(1).join(" - ") || "Autor não informado").trim() };
  }
  private decode(value: string): string { return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"); }
}
