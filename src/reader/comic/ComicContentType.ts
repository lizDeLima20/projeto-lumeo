import type { Book } from "../../models/Book";

/** A library item is a comic only when it was explicitly marked as one. Guessing from the
 *  file alone would drag existing PDFs into a reader they were never meant for, so an
 *  unmarked book stays a book. */
export type BookContentType = "book" | "comic";

export class ComicContentTypeResolver {
  public resolve(book: Pick<Book, "contentType" | "fileType"> | null): BookContentType {
    if (!book) return "book";
    if (book.fileType !== "pdf") return "book";
    return book.contentType === "comic" ? "comic" : "book";
  }
  public isComic(book: Pick<Book, "contentType" | "fileType"> | null): boolean { return this.resolve(book) === "comic"; }
}
