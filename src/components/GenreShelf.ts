import type { Book } from "../models/Book";
import type { Genre } from "../models/Genre";
import { BookShelf } from "./BookShelf";

export class GenreShelf {
  public constructor(private readonly genre: Genre, private readonly books: readonly Book[],
    private readonly onGenreOpen: (genreId: string) => void, private readonly onBookOpen: (bookId: string) => void, private readonly onBookDelete?: (bookId: string) => void | Promise<void>) {}
  public render(): HTMLElement {
    const section = document.createElement("section"); section.className = "genre-shelf"; section.dataset.genreId = this.genre.id;section.dataset.searchText=[this.genre.name,...this.books.flatMap(book=>[book.title,book.author])].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase();
    const heading = document.createElement("button"); heading.type = "button"; heading.className = "genre-shelf__title"; heading.textContent = this.genre.name;
    heading.addEventListener("click", () => this.onGenreOpen(this.genre.id)); const count = document.createElement("span"); count.className = "genre-shelf__count"; count.textContent = `${this.books.length} ${this.books.length === 1 ? "livro" : "livros"}`;
    /* A genre owns one physical board and one horizontal track. Author/series ordering
       * is resolved inside BookShelf; it must never split a genre into stacked boards. */
    section.append(heading, count, new BookShelf(this.books, this.onBookOpen, { kind:"genre", label:this.genre.name }, this.onBookDelete).render());
    return section;
  }
  public static shouldRender(books: readonly Book[]): boolean { return books.length > 0; }
}
