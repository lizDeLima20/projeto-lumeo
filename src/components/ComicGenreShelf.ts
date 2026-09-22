import type { Book } from "../models/Book";
import type { Genre } from "../models/Genre";
import { ComicShelfGrouping } from "../reader/comic/ComicCollectionTrail";
import { BookShelf } from "./BookShelf";

/** A genre made of comics, shelved the way its Drive tree is organised: one row per
 *  collection - Fênix, Deadpool, Guerras Secretas - each its own horizontal board of the
 *  same 3D books every other genre uses. Many comics stay a few rows, not one endless
 *  track, and the order is the tree's, never the order they were added in. */
export class ComicGenreShelf {
  public constructor(private readonly genre: Genre, private readonly books: readonly Book[],
    private readonly onGenreOpen: (genreId: string) => void, private readonly onBookOpen: (bookId: string) => void,
    private readonly onBookDelete?: (bookId: string) => void | Promise<void>) {}

  /** A genre is shelved as comics only when every book in it is one: a genre that mixes
   *  books in keeps the ordinary shelf, untouched. */
  public static handles(books: readonly Book[]): boolean {
    return books.length > 0 && books.every(book => book.contentType === "comic");
  }

  public render(): HTMLElement {
    const section = document.createElement("section");
    section.className = "genre-shelf comic-genre-shelf"; section.dataset.genreId = this.genre.id;
    section.dataset.searchText = [this.genre.name, ...this.books.flatMap(book => [book.title, book.series ?? ""])].join(" ")
      .normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();
    const heading = document.createElement("button");
    heading.type = "button"; heading.className = "genre-shelf__title"; heading.textContent = this.genre.name;
    heading.addEventListener("click", () => this.onGenreOpen(this.genre.id));
    const count = document.createElement("span");
    count.className = "genre-shelf__count"; count.textContent = `${this.books.length} ${this.books.length === 1 ? "HQ" : "HQs"}`;
    section.append(heading, count);
    for (const row of new ComicShelfGrouping().rows(this.books)) {
      const group = document.createElement("section");
      group.className = "comic-shelf-row"; group.dataset.collection = row.key;
      const title = document.createElement("h3");
      title.className = "comic-shelf-row__title"; title.textContent = row.title;
      const shelf = new BookShelf(row.books, this.onBookOpen, { kind: "genre", label: row.title }, this.onBookDelete).render();
      group.append(title, shelf);
      section.append(group);
    }
    return section;
  }
}
