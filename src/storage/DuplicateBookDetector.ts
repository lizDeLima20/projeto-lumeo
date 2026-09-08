import type { Book } from "../models/Book";
import { BookSeriesResolver } from "../components/BookSeriesResolver";

export interface BookFingerprint {
  bookId: string;
  size: number;
  hash: string;
}

export type DuplicateDecision =
  | { kind: "duplicate"; book: Book; reason: "hash" | "metadata" }
  | { kind: "same-series-volume"; book: Book; volume: number }
  | { kind: "possible-version"; book: Book; reason: "edition-or-year" | "same-title-different-file" }
  | { kind: "new-book" };

export interface IncomingBookIdentity {
  title: string;
  author: string;
  volume?: string;
  series?: string;
  publicationYear?: number;
  fileName: string;
  fileSize: number;
  hash: string;
}

export class DuplicateBookDetector {
  private readonly series = new BookSeriesResolver();

  public findDuplicate(existing: readonly BookFingerprint[], incoming: Pick<BookFingerprint, "size" | "hash">): BookFingerprint | null {
    return existing.find((item) => item.size === incoming.size && item.hash === incoming.hash) ?? null;
  }

  public classify(existing: readonly Book[], hashes: ReadonlyMap<string, string>, incoming: IncomingBookIdentity): DuplicateDecision {
    const exact = existing.find((book) => hashes.get(book.id) === incoming.hash);
    if (exact) return { kind: "duplicate", book: exact, reason: "hash" };

    const incomingBook = this.asComparableBook(incoming);
    for (const book of existing) {
      const sameSeries = this.series.sameSeries(book, incomingBook);
      const current = this.series.resolve(book);
      const next = this.series.resolve(incomingBook);
      if (sameSeries && current.volume !== undefined && next.volume !== undefined && current.volume !== next.volume) {
        return { kind: "same-series-volume", book, volume: next.volume };
      }
    }

    const sameTitle = existing.find((book) => this.normalize(book.title) === this.normalize(incoming.title) && this.normalize(book.author) === this.normalize(incoming.author));
    if (sameTitle) {
      const knownHash = hashes.get(sameTitle.id);
      if (knownHash && knownHash !== incoming.hash) return { kind: "possible-version", book: sameTitle, reason: "same-title-different-file" };
      if (sameTitle.publicationYear && incoming.publicationYear && sameTitle.publicationYear !== incoming.publicationYear) {
        return { kind: "possible-version", book: sameTitle, reason: "edition-or-year" };
      }
      if (sameTitle.fileSize !== incoming.fileSize || sameTitle.fileName !== incoming.fileName) {
        return { kind: "possible-version", book: sameTitle, reason: "same-title-different-file" };
      }
      if (!knownHash) return { kind: "duplicate", book: sameTitle, reason: "metadata" };
    }

    return { kind: "new-book" };
  }

  public normalizeTitleWithoutVolume(value: string): string {
    return this.series.resolve({ title: value, author: "", volume: undefined, series: undefined }).normalizedBaseTitle;
  }

  private asComparableBook(incoming: IncomingBookIdentity): Pick<Book, "title" | "author" | "volume" | "series"> {
    return { title: incoming.title, author: incoming.author, volume: incoming.volume, series: incoming.series };
  }

  private normalize(value: string): string {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
  }
}
