import { Book } from "./Book";
import { Genre } from "./Genre";

export class Library {
  public constructor(
    private readonly books: Book[] = [],
    private readonly genres: Genre[] = [],
  ) {}

  public getBooks(): readonly Book[] {
    return this.books;
  }

  public getGenres(): readonly Genre[] {
    return this.genres;
  }

  public addBook(book: Book): void {
    if (!this.findBookById(book.id)) this.books.push(book);
  }

  public removeBook(id: string): void {
    const index = this.books.findIndex((book) => book.id === id);
    if (index >= 0) this.books.splice(index, 1);
  }

  public addGenre(genre: Genre): void {
    if (!this.genres.some((item) => item.id === genre.id || item.name.toLocaleLowerCase() === genre.name.toLocaleLowerCase())) {
      this.genres.push(genre);
    }
  }

  public removeGenre(id: string): void {
    const index = this.genres.findIndex((genre) => genre.id === id);
    if (index >= 0) this.genres.splice(index, 1);
  }

  public replaceBooks(books: readonly Book[]): void {
    this.books.splice(0, this.books.length, ...books);
  }

  public replaceGenres(genres: readonly Genre[]): void {
    this.genres.splice(0, this.genres.length, ...genres);
  }

  public findBooksByGenre(genreId: string): readonly Book[] {
    return this.books.filter((book) => book.genreId === genreId);
  }

  public findBookById(id: string): Book | undefined {
    return this.books.find((book) => book.id === id);
  }
}
