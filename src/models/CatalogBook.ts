/** The public catalogue only ever serves these two formats. CBR/CBZ remain valid for
 *  local import, the library and the comic reader (BookFileType) - never here, since
 *  nothing upstream (Drive sources, the server) can produce a catalogue entry for them. */
export type CatalogBookFormat = "pdf" | "epub";

/** Metadata available remotely. It never contains the book file itself. */
export interface CatalogBookData {
  bookId: string;
  title: string;
  author: string;
  genreId: string;
  genreName: string;
  coverUrl?: string;
  description?: string;
  format: CatalogBookFormat;
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
  /** Genres present in the catalogue sources, each one a filter. */
  genres?: ReadonlyArray<{ id: string; name: string }>;
}
