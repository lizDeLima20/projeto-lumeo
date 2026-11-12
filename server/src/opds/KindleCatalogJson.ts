import type { CatalogBookRecord, CatalogGenre } from "../catalog/types.js";
import type { KindleOffer } from "../kindle/KindleEditions.js";
import { opdsLanguageName } from "./OpdsFeedBuilder.js";

/** One book as the Kindle extension (kindle/lumeo.koplugin) shows it on its book screen. */
export interface KindleBookJson {
  id: string;
  title: string;
  author: string;
  synopsis: string | null;
  language: string | null;
  languageName: string | null;
  genre: string;
  /** The genre's id, so a search result can select its genre in the extension's carousel. */
  genreId: string;
  collection: string | null;
  volume: string | null;
  /** Large cover (600 px) for the book screen, and the grid's cover (300 px); null when the book has none. */
  cover: string | null;
  thumbnail: string | null;
  /** The file in the catalog (EPUB or PDF). */
  original: { format: string; size: number | null };
  /** What "Baixar para a biblioteca" saves into the Kindle library: only a converted AZW3. */
  kindle: {
    status: KindleOffer["status"];
    format: "azw3" | null;
    size: number | null;
    url: string | null;
    /** "Autor - Título.azw3", already free of characters the Kindle's FAT storage refuses. */
    fileName: string | null;
  };
}

export interface KindleBooksPageJson { page: number; hasNext: boolean; books: KindleBookJson[]; }
export interface KindleGenresJson { catalog: string; genres: Array<{ id: string; name: string }>; }

/** Characters FAT32 (the Kindle's user storage) does not accept in names, plus control characters. */
const FORBIDDEN = /[\u0000-\u001F\u007F"*/:<>?\\|]/g;

/** "Autor - Título.azw3", safe on the Kindle's storage and at most ~200 bytes long. */
export function kindleFileName(book: Pick<CatalogBookRecord, "author" | "title" | "bookId">, format: string): string {
  const clean = (value: string) => value.replace(FORBIDDEN, " ").replace(/\s+/g, " ").trim();
  const author = clean(book.author), title = clean(book.title);
  let base = [author && author !== "Autor não informado" ? author : "", title].filter(Boolean).join(" - ") || clean(book.bookId) || "livro";
  // Byte budget (names are UTF-8 on the device); cut on a character boundary.
  while (Buffer.byteLength(base, "utf8") > 200) base = [...base].slice(0, -1).join("");
  base = base.replace(/[ .]+$/g, "") || "livro";
  return `${base}.${format}`;
}

/** Turns catalog books into the extension's JSON. Every link is absolute, made from `base`. */
export class KindleCatalogJson {
  public constructor(private readonly base: string) {}

  public genres(genres: readonly CatalogGenre[]): KindleGenresJson {
    return { catalog: "Lumeo", genres: genres.map((genre) => ({ id: genre.id, name: genre.name })) };
  }

  public page(page: number, hasNext: boolean, books: readonly CatalogBookRecord[], offers: ReadonlyMap<string, KindleOffer>): KindleBooksPageJson {
    return { page, hasNext, books: books.map((book) => this.book(book, offers.get(book.bookId)!)) };
  }

  public book(book: CatalogBookRecord, offer: KindleOffer): KindleBookJson {
    const id = encodeURIComponent(book.bookId), ready = offer.status === "ready";
    return {
      id: book.bookId,
      title: book.title,
      author: book.author,
      synopsis: book.description?.trim() || null,
      language: book.language ?? null,
      languageName: book.language ? opdsLanguageName(book.language) : null,
      genre: book.genreName,
      genreId: book.genreId,
      collection: book.collection ?? null,
      volume: book.volume ?? null,
      cover: book.coverUrl ? `${this.base}/livros/${id}/capa?tamanho=grande` : null,
      thumbnail: book.coverUrl ? `${this.base}/livros/${id}/capa` : null,
      original: { format: book.format, size: book.fileSize },
      kindle: {
        status: offer.status,
        format: ready ? offer.format : null,
        size: ready ? offer.size : null,
        url: ready ? `${this.base}/livros/${id}/download?formato=kindle` : null,
        fileName: ready ? kindleFileName(book, offer.format) : null,
      },
    };
  }
}
