import type { BookFileType } from "./Book";

/** Metadata available remotely. It never contains the book file itself. */
export interface CatalogBookData {
  bookId: string;
  title: string;
  author: string;
  genreId: string;
  genreName: string;
  coverUrl?: string;
  description?: string;
  format: BookFileType;
  fileSize?: number;
  driveFileId: string;
  storageAccountId: string;
  sha256?: string;
  volume?: string;
  collection?: string;
  language?: string;
  createdAt: string;
  updatedAt: string;
  status: CatalogBookStatus;
}

export type CatalogBookStatus = "ACTIVE" | "UNAVAILABLE" | "PROCESSING" | "INVALID" | "ERROR";

export class CatalogBook {
  public constructor(public readonly data: CatalogBookData) {}
}

export interface CatalogPage {
  items: readonly CatalogBookData[];
  nextCursor: string | null;
}
