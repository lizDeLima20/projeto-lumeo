import type { IncomingMessage, ServerResponse } from "node:http";
import type { CatalogApplicationService } from "../catalog/CatalogApplicationService.js";
import { ApiError } from "../errors/ApiError.js";
import type { CatalogBookRecord } from "../catalog/types.js";
import { TolerantKindleEditions, kindleOffer, type KindleEditionReader, type KindleOffer } from "../kindle/KindleEditions.js";
import { KindleCatalogJson } from "./KindleCatalogJson.js";
import { OpdsAuth } from "./OpdsAuth.js";
import type { OpdsCoverService } from "./OpdsCoverService.js";
import type { OpdsDownloadService, OpdsDownloadTarget } from "./OpdsDownloadService.js";
import { OPDS_ACQUISITION, OPDS_NAVIGATION, OPENSEARCH, OpdsFeedBuilder } from "./OpdsFeedBuilder.js";

/** Books per acquisition page. */
export const OPDS_PAGE_SIZE = 30;
export const OPDS_PREFIX = "/api/opds";

export const isOpdsRequest = (path: string): boolean => path === OPDS_PREFIX || path.startsWith(`${OPDS_PREFIX}/`);

export type OpdsCatalog = Pick<CatalogApplicationService, "list" | "get">;
export interface OpdsSettings { locale?: string; requireHttps: boolean; }

/** No Kindle editions at all (tests, or a server without the editions store). */
const NO_EDITIONS: KindleEditionReader = { editionsFor: async () => new Map(), signedUrl: async () => { throw new Error("KINDLE_EDITIONS_DISABLED"); } };

/**
 * The OPDS 1.2 catalog read by KOReader (Kindle): genres, their books, covers, downloads and a
 * search, all behind HTTP Basic Auth. It reads the very same catalog the Android app does and
 * changes nothing in it.
 */
export class OpdsController {
  private readonly editions: KindleEditionReader;
  public constructor(private readonly catalog: OpdsCatalog, private readonly auth: OpdsAuth, private readonly covers: OpdsCoverService,
    private readonly downloads: OpdsDownloadService, private readonly settings: OpdsSettings, editions: KindleEditionReader = NO_EDITIONS) {
    this.editions = new TolerantKindleEditions(editions);
  }

  public async handle(request: IncomingMessage, response: ServerResponse, path: string, ip: string): Promise<void> {
    if (request.method !== "GET" && request.method !== "HEAD") return this.text(response, 405, "Método não permitido.", { Allow: "GET, HEAD" });
    const proto = String(request.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim();
    if (this.settings.requireHttps && proto !== "https") return this.text(response, 403, "O catálogo só responde por HTTPS.");
    const result = await this.auth.authenticate(request, ip);
    if (result.kind === "locked") return this.text(response, 429, "Muitas tentativas de login. Tente de novo mais tarde.", { "Retry-After": String(result.retryAfterSeconds) });
    if (result.kind !== "ok") return this.text(response, 401, "Login necessário.", { "WWW-Authenticate": "Basic realm=\"Lumeo\", charset=\"UTF-8\"" });
    const url = new URL(request.url ?? "/", "http://localhost"), route = path.slice(OPDS_PREFIX.length).replace(/^\/+|\/+$/g, "");
    const feeds = new OpdsFeedBuilder(this.base(request, proto));
    if (route === "") {
      const page = await this.catalog.list({ offset: 0, limit: 1, locale: this.settings.locale });
      return this.xml(response, OPDS_NAVIGATION, feeds.root(page.genres ?? []));
    }
    if (route === "opensearch.xml") return this.xml(response, OPENSEARCH, feeds.openSearch());
    const genre = /^generos\/([^/]+)$/.exec(route);
    if (genre) {
      const genreId = decodeURIComponent(genre[1]!), number = this.page(url);
      const result = await this.catalog.list({ offset: (number - 1) * OPDS_PAGE_SIZE, limit: OPDS_PAGE_SIZE, genreId, locale: this.settings.locale });
      const name = result.genres?.find((item) => item.id === genreId)?.name ?? result.items[0]?.genreName;
      if (!name) return this.text(response, 404, "Gênero não encontrado.");
      return this.xml(response, OPDS_ACQUISITION, feeds.acquisition({ id: `urn:lumio:genre:${genreId}`, title: name, path: `generos/${encodeURIComponent(genreId)}`, page: number, hasNext: Boolean(result.nextCursor), books: result.items, offers: await this.offers(result.items) }));
    }
    if (route === "busca") {
      const query = (url.searchParams.get("q") ?? "").trim().slice(0, 120), number = this.page(url);
      if (!query) return this.text(response, 400, "Informe o que buscar.");
      const result = await this.catalog.list({ offset: (number - 1) * OPDS_PAGE_SIZE, limit: OPDS_PAGE_SIZE, query, locale: this.settings.locale });
      return this.xml(response, OPDS_ACQUISITION, feeds.acquisition({ id: `urn:lumio:search:${encodeURIComponent(query)}`, title: `Busca: ${query}`, path: `busca?q=${encodeURIComponent(query)}`, page: number, hasNext: Boolean(result.nextCursor), books: result.items, offers: await this.offers(result.items) }));
    }
    if (route === "kindle" || route.startsWith("kindle/")) return this.kindle(response, route.slice("kindle".length).replace(/^\/+/, ""), url, this.base(request, proto));
    const book = /^livros\/([^/]+)\/(capa|download)$/.exec(route);
    if (book) {
      const record = await this.catalog.get(decodeURIComponent(book[1]!), this.settings.locale).catch((error: unknown) => { if (error instanceof ApiError && error.status === 404) return null; throw error; });
      if (!record) return this.text(response, 404, "Livro não encontrado.");
      if (book[2] === "capa") {
        if (!record.coverUrl) return this.text(response, 404, "Este livro não tem capa.");
        const size = url.searchParams.get("tamanho");
        const jpeg = await this.covers.cover(record.bookId, record.coverUrl, size === "miniatura" || size === "grande" ? size : "capa").catch((error: unknown) => {
          console.warn(JSON.stringify({ event: "OPDS_COVER_FAILED", bookId: record.bookId, reason: error instanceof Error ? error.message : "unknown" })); return null;
        });
        if (!jpeg) return this.text(response, 502, "Não foi possível obter a capa.");
        response.statusCode = 200; response.setHeader("Content-Type", "image/jpeg"); response.setHeader("Content-Length", String(jpeg.length));
        // Behind a login: kept by the reader, never by a shared cache.
        response.setHeader("Cache-Control", "private, max-age=604800");
        response.end(request.method === "HEAD" ? undefined : jpeg); return;
      }
      if (record.format !== "epub" && record.format !== "pdf") return this.text(response, 404, "Formato não disponível no catálogo.");
      const wanted = url.searchParams.get("formato");
      if (wanted !== null && wanted !== "kindle") return this.text(response, 400, "Formato pedido desconhecido.");
      let target: OpdsDownloadTarget | undefined;
      if (wanted === "kindle") {
        const offer = kindleOffer(record, (await this.editions.editionsFor([record.bookId])).get(record.bookId));
        if (offer.status !== "ready") return this.text(response, 409, offer.status === "pending" || offer.status === "processing" ? "A versão Kindle deste livro ainda está sendo preparada. Tente de novo mais tarde." : "Este livro não tem versão Kindle (AZW3).");
        target = { format: offer.format, bytes: offer.size, url: () => this.editions.signedUrl(offer.edition) };
      }
      const download = await this.downloads.download(result.user.id, record, target).catch((error: unknown) => {
        console.warn(JSON.stringify({ event: "OPDS_DOWNLOAD_FAILED", bookId: record.bookId, format: wanted ?? record.format, reason: error instanceof Error ? error.message : (error as { message?: string })?.message ?? "unknown" }));
        return null;
      });
      if (!download) return this.text(response, 502, "Não foi possível preparar o download. Tente de novo.");
      if (download.kind === "limited") return this.text(response, 429, "Limite de downloads por hora atingido. Tente de novo mais tarde.", { "Retry-After": String(download.retryAfterSeconds) });
      response.statusCode = 302; response.setHeader("Location", download.url); response.setHeader("Cache-Control", "no-store"); response.end(); return;
    }
    return this.text(response, 404, "Endereço não encontrado no catálogo.");
  }

  /** What the Kindle gets for each of these books. */
  private async offers(books: readonly CatalogBookRecord[]): Promise<ReadonlyMap<string, KindleOffer>> {
    const editions = await this.editions.editionsFor(books.map((book) => book.bookId));
    return new Map(books.map((book) => [book.bookId, kindleOffer(book, editions.get(book.bookId))]));
  }

  /** The JSON read by the Kindle extension: genres, pages of books (a genre, a search or all) and
   *  one book. Same catalog, same login. */
  private async kindle(response: ServerResponse, route: string, url: URL, base: string): Promise<void> {
    const json = new KindleCatalogJson(`${base}`);
    if (route === "generos") {
      const page = await this.catalog.list({ offset: 0, limit: 1, locale: this.settings.locale });
      return this.json(response, json.genres(page.genres ?? []));
    }
    if (route === "livros") {
      const number = this.page(url), genreId = url.searchParams.get("genero")?.trim() || undefined;
      const query = (url.searchParams.get("q") ?? "").trim().slice(0, 120) || undefined;
      const result = await this.catalog.list({ offset: (number - 1) * OPDS_PAGE_SIZE, limit: OPDS_PAGE_SIZE, genreId, query, locale: this.settings.locale });
      return this.json(response, json.page(number, Boolean(result.nextCursor), result.items, await this.offers(result.items)));
    }
    const one = /^livros\/([^/]+)$/.exec(route);
    if (one) {
      const record = await this.catalog.get(decodeURIComponent(one[1]!), this.settings.locale).catch((error: unknown) => { if (error instanceof ApiError && error.status === 404) return null; throw error; });
      if (!record) return this.text(response, 404, "Livro não encontrado.");
      return this.json(response, { book: json.book(record, (await this.offers([record])).get(record.bookId)!) });
    }
    return this.text(response, 404, "Endereço não encontrado no catálogo.");
  }

  private json(response: ServerResponse, body: unknown): void {
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    // Short: a book's Kindle edition may become ready at any moment.
    response.setHeader("Cache-Control", "private, max-age=60");
    response.end(JSON.stringify(body));
  }

  /** The catalog root as the reader reached it (Vercel forwards the original host). */
  private base(request: IncomingMessage, proto: string | undefined): string {
    const host = String(request.headers["x-forwarded-host"] ?? request.headers.host ?? "localhost").split(",")[0]!.trim();
    return `${this.settings.requireHttps ? "https" : proto || "http"}://${host}${OPDS_PREFIX}`;
  }

  private page(url: URL): number {
    const value = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
    return Number.isFinite(value) && value >= 1 ? Math.min(value, 10_000) : 1;
  }

  private xml(response: ServerResponse, type: string, body: string): void {
    response.statusCode = 200;
    response.setHeader("Content-Type", `${type};charset=utf-8`);
    response.setHeader("Cache-Control", "private, max-age=300");
    response.end(body);
  }

  private text(response: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
    response.statusCode = status;
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(message);
  }
}
