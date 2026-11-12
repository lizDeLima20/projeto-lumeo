import type { CatalogBookRecord, CatalogFormat, CatalogGenre } from "../catalog/types.js";
import { KINDLE_FILE_TYPES, type KindleOffer } from "../kindle/KindleEditions.js";

/** OPDS 1.2 media types (Atom feeds) and the file types offered for download. */
export const OPDS_NAVIGATION = "application/atom+xml;profile=opds-catalog;kind=navigation";
export const OPDS_ACQUISITION = "application/atom+xml;profile=opds-catalog;kind=acquisition";
export const OPENSEARCH = "application/opensearchdescription+xml";
/** Every format the catalog can offer. CBZ/CBR are listed for the comics entry still to come. */
export const OPDS_FILE_TYPES: Readonly<Record<CatalogFormat | "cbz" | "cbr", string>> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  cbz: "application/vnd.comicbook+zip",
  cbr: "application/vnd.comicbook-rar",
};

/** One entry of the root navigation feed: a genre today, the comics collections later. */
export interface OpdsNavigationEntry { id: string; title: string; href: string; summary?: string; kind?: "navigation" | "acquisition"; }

export interface OpdsAcquisitionPage {
  id: string; title: string;
  /** Path of this feed below the catalog root, without page ("generos/x", "busca?q=y"). */
  path: string;
  page: number; hasNext: boolean;
  books: readonly CatalogBookRecord[];
  /** What the Kindle gets for each book (by bookId); books without an entry get no Kindle line. */
  offers?: ReadonlyMap<string, KindleOffer>;
}

/** Escapes text for XML content and attribute values, and drops characters XML 1.0 forbids. */
export function xml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" })[character]!);
}

const html = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);

/** "EPUB · 1,2 MB": the file the download button gets. */
export function opdsFormatLabel(book: { format: string; fileSize: number | null }): string {
  const number = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
  const bytes = book.fileSize ?? 0;
  const size = bytes <= 0 ? "" : bytes >= 1024 * 1024 ? ` · ${number(bytes / 1024 / 1024)} MB` : ` · ${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${book.format.toUpperCase()}${size}`;
}

/** The card's Kindle line: the file the Kindle gets, or why there is none yet. */
export function opdsKindleLabel(offer: KindleOffer): string {
  if (offer.status === "ready") return opdsFormatLabel({ format: offer.format, fileSize: offer.size });
  return offer.status === "failed" || offer.status === "unavailable" ? "versão Kindle indisponível" : "versão Kindle em preparação";
}

/** "Português (Brasil)" for "pt-BR"; the code itself when the name is unknown. */
export function opdsLanguageName(code: string): string {
  try { const name = new Intl.DisplayNames(["pt-BR"], { type: "language" }).of(code); if (name && name !== code) return name.charAt(0).toLocaleUpperCase("pt-BR") + name.slice(1); } catch { /* invalid code */ }
  return code;
}

/**
 * The book's card for the reader's details page, as HTML. KOReader turns it into plain text
 * (each <br/> a line break; other tags such as <b> are dropped, their text kept), so it is made of
 * labelled lines; readers that render HTML get the same card with bold labels.
 */
export function opdsBookCard(book: CatalogBookRecord, offer?: KindleOffer): string {
  const line = (label: string, value: string | null | undefined): string[] => (value?.trim() ? [`<b>${label}:</b> ${html(value.trim())}`] : []);
  const details = [
    ...line("Título", book.title),
    ...line("Autor", book.author),
    ...line("Gênero", book.genreName),
    ...line("Coleção", book.collection),
    ...line("Volume", book.volume),
    ...line("Idioma", book.language ? opdsLanguageName(book.language) : null),
    ...line("Formato", opdsFormatLabel(book)),
    ...line("Kindle", offer ? opdsKindleLabel(offer) : null),
  ];
  const synopsis = book.description?.trim() ? html(book.description.trim()).replace(/\r?\n/g, "<br/>") : "Sinopse não disponível.";
  return `${details.join("<br/>")}<br/><br/><b>Sinopse</b><br/>${synopsis}`;
}

/**
 * Builds the catalog's Atom/OPDS 1.2 documents. Every link is absolute, made from `base` (the
 * catalog root, e.g. https://lumeo-livros.vercel.app/api/opds), so readers resolve them the same
 * way whatever feed they came from.
 */
export class OpdsFeedBuilder {
  public constructor(private readonly base: string, private readonly now: () => Date = () => new Date()) {}

  /** The root: one navigation entry per genre, plus `extra` entries (the comics entry, later). */
  public root(genres: readonly CatalogGenre[], extra: readonly OpdsNavigationEntry[] = []): string {
    const entries: OpdsNavigationEntry[] = [
      ...genres.map((genre): OpdsNavigationEntry => ({ id: `urn:lumio:genre:${genre.id}`, title: genre.name, href: this.url(`generos/${encodeURIComponent(genre.id)}`), kind: "acquisition" })),
      ...extra,
    ];
    return this.feed({ id: "urn:lumio:catalog", title: "Lumio", kind: OPDS_NAVIGATION, self: this.url(""), links: [], body: entries.map((entry) => this.navigationEntry(entry)).join("") });
  }

  /** A page of books (a genre or a search), 30 per page with first/previous/next links. */
  public acquisition(page: OpdsAcquisitionPage): string {
    const links = [`<link rel="first" href="${xml(this.pageUrl(page.path, 1))}" type="${OPDS_ACQUISITION}"/>`];
    if (page.page > 1) links.push(`<link rel="previous" href="${xml(this.pageUrl(page.path, page.page - 1))}" type="${OPDS_ACQUISITION}"/>`);
    if (page.hasNext) links.push(`<link rel="next" href="${xml(this.pageUrl(page.path, page.page + 1))}" type="${OPDS_ACQUISITION}"/>`);
    links.push(`<link rel="up" href="${xml(this.url(""))}" type="${OPDS_NAVIGATION}"/>`);
    return this.feed({ id: page.id, title: page.title, kind: OPDS_ACQUISITION, self: this.pageUrl(page.path, page.page), links, body: page.books.map((book) => this.bookEntry(book, page.offers?.get(book.bookId))).join("") });
  }

  /** OpenSearch description: searching by title or author. */
  public openSearch(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">`
      + `<ShortName>Lumio</ShortName><Description>Buscar livros por título ou autor</Description><InputEncoding>UTF-8</InputEncoding><OutputEncoding>UTF-8</OutputEncoding>`
      + `<Url type="${OPDS_ACQUISITION}" template="${xml(this.url("busca"))}?q={searchTerms}"/></OpenSearchDescription>\n`;
  }

  private feed(input: { id: string; title: string; kind: string; self: string; links: readonly string[]; body: string }): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/" xmlns:opds="http://opds-spec.org/2010/catalog">`
      + `<id>${xml(input.id)}</id><title>${xml(input.title)}</title><updated>${this.now().toISOString()}</updated><author><name>Lumio</name></author>`
      + `<link rel="self" href="${xml(input.self)}" type="${input.kind}"/>`
      + `<link rel="start" href="${xml(this.url(""))}" type="${OPDS_NAVIGATION}"/>`
      + `<link rel="search" href="${xml(this.url("opensearch.xml"))}" type="${OPENSEARCH}"/>`
      + input.links.join("") + input.body + `</feed>\n`;
  }

  private navigationEntry(entry: OpdsNavigationEntry): string {
    const type = entry.kind === "navigation" ? OPDS_NAVIGATION : OPDS_ACQUISITION;
    return `<entry><title>${xml(entry.title)}</title><id>${xml(entry.id)}</id><updated>${this.now().toISOString()}</updated>`
      + (entry.summary ? `<content type="text">${xml(entry.summary)}</content>` : "")
      + `<link rel="subsection" href="${xml(entry.href)}" type="${type}"/></entry>`;
  }

  private bookEntry(book: CatalogBookRecord, offer?: KindleOffer): string {
    const id = encodeURIComponent(book.bookId), file = OPDS_FILE_TYPES[book.format], label = opdsFormatLabel(book);
    return `<entry><title>${xml(book.title)}</title><id>urn:lumio:book:${xml(book.bookId)}</id><updated>${xml(this.date(book.updatedAt))}</updated>`
      + (book.author ? `<author><name>${xml(book.author)}</name></author>` : "")
      + (book.language ? `<dc:language>${xml(book.language)}</dc:language>` : "")
      + `<dc:format>${file}</dc:format>`
      + `<category term="${xml(book.genreId)}" label="${xml(book.genreName)}"/>`
      + (book.description ? `<summary type="text">${xml(book.description)}</summary>` : "")
      // KOReader shows only this text on the book's page (as "Book description"): the book's own
      // card - title, author, genre, language, format, then the synopsis.
      + `<content type="html">${xml(opdsBookCard(book, offer))}</content>`
      + (book.coverUrl ? `<link rel="http://opds-spec.org/image" href="${xml(this.url(`livros/${id}/capa`))}" type="image/jpeg"/>`
        + `<link rel="http://opds-spec.org/image/thumbnail" href="${xml(this.url(`livros/${id}/capa?tamanho=miniatura`))}" type="image/jpeg"/>` : "")
      + `<link rel="http://opds-spec.org/acquisition" href="${xml(this.url(`livros/${id}/download`))}" type="${file}" title="${xml(label)}"${book.fileSize ? ` length="${book.fileSize}"` : ""}/>`
      // The Kindle edition (AZW3) made from the EPUB.
      + (offer?.status === "ready"
        ? `<link rel="http://opds-spec.org/acquisition" href="${xml(this.url(`livros/${id}/download?formato=kindle`))}" type="${KINDLE_FILE_TYPES[offer.format]}" title="${xml(`Kindle · ${opdsKindleLabel(offer)}`)}"${offer.size ? ` length="${offer.size}"` : ""}/>` : "")
      + `</entry>`;
  }

  private url(path: string): string { return path ? `${this.base}/${path}` : this.base; }
  private pageUrl(path: string, page: number): string { const href = this.url(path); return page > 1 ? `${href}${href.includes("?") ? "&" : "?"}page=${page}` : href; }
  private date(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? this.now().toISOString() : date.toISOString(); }
}
