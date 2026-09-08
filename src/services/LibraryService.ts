import type { Book } from "../models/Book";
import { BookRepository } from "../repositories/BookRepository";
import { ReadingProgressRepository } from "../repositories/ReadingProgressRepository";
interface DeletableBookFiles { delete(bookId:string):Promise<unknown>; }
interface DeletableBookData { delete(bookId:string):Promise<unknown>; }
interface BookLinkedDataCleaner { deleteByBook(bookId:string):Promise<unknown>; }

export class LibraryService {
  public constructor(private readonly books: BookRepository, private readonly files: DeletableBookFiles,
    private readonly progress: ReadingProgressRepository,
    private readonly linkedData: readonly (DeletableBookData|BookLinkedDataCleaner)[] = []) {}
  public saveBook(book: Book): Promise<void> { return this.books.save(book); }
  public async deleteBook(bookId: string): Promise<void> {
    await Promise.all([
      this.books.delete(bookId),
      this.files.delete(bookId),
      this.progress.delete(bookId),
      ...this.linkedData.map(item=>"deleteByBook" in item ? item.deleteByBook(bookId) : item.delete(bookId)),
    ]);
  }
}
