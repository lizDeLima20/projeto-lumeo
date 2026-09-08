import type { Book } from "../models/Book";
import { Book3D } from "./Book3D";
import type { Book3DMode, Book3DModel } from "./Book3DModel";
import { BookSpineColorService } from "./BookSpineColorService";

export class Book3DFactory {
  public constructor(private readonly colors = new BookSpineColorService()) {}
  public model(book: Book, mode: Book3DMode,showAuthor=true): Book3DModel {
    return { bookId: book.id, cover: book.cover, title: book.title, author: book.author,showAuthor,volume: book.volume, series: book.series, publicationYear: book.publicationYear, genre: book.genreId,
      spineColor: this.colors.fallback(book.fileType), dimensions: { widthRem: 9.2, aspectRatio: 2 / 3, depthRem: 4.2, spineRem: 4.2 }, mode };
  }
  public create(book: Book, mode: Book3DMode,showAuthor=true): Book3D { return new Book3D(this.model(book,mode,showAuthor),this.colors); }
}
