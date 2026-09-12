import { Book } from "../models/Book";
import { BookRepository } from "../repositories/BookRepository";
import { ReadingProgressRepository, type ReadingProgress } from "../repositories/ReadingProgressRepository";

export class ReadingProgressService {
  public constructor(private readonly progress: ReadingProgressRepository, private readonly books: BookRepository) {}
  public calculateProgress(currentPage: number, totalPages: number): number {
    if (totalPages < 1) return 0; return Math.min(100, Math.max(0, (currentPage / totalPages) * 100));
  }
  public async restoreProgress(bookId: string): Promise<ReadingProgress | null> { return this.progress.get(bookId); }
  public async saveProgress(book: Book, currentPage: number, totalPages: number, reachedEndByNext: boolean, logicalLocation?: string): Promise<Book> {
    const progressPercent = this.calculateProgress(currentPage, totalPages);
    const readingStatus = reachedEndByNext && currentPage === totalPages ? "finished" : book.readingStatus === "finished" ? "finished" : "reading";
    const updated = new Book({ id: book.id, title: book.title, author: book.author, genreId: book.genreId, cover: book.cover,
      fileType: book.fileType, fileName: book.fileName, fileSize: book.fileSize, mimeType: book.mimeType, readingStatus,
      createdAt: book.createdAt, updatedAt: new Date(), currentLocation: logicalLocation??String(currentPage), progressPercent, collectionId: book.collectionId,
      conversionStatus:book.conversionStatus,availability:book.availability,volume:book.volume,summary:book.summary,description:book.description,publicationYear:book.publicationYear,series:book.series,documentMode:book.documentMode,textCapability:book.textCapability,limaCapability:book.limaCapability,offlineAvailability:book.offlineAvailability,catalogBookId:book.catalogBookId,source:book.source });
    await Promise.all([this.progress.save({ bookId: book.id, currentPage, totalPages, currentLocation: logicalLocation??String(currentPage), progressPercent, updatedAt: new Date().toISOString() }), this.books.save(updated)]);
    return updated;
  }
}
