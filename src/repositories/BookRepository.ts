import { Book, type BookData } from "../models/Book";
import { IndexedDbService, STORE_NAMES } from "../services/IndexedDbService";

interface StoredBook extends Omit<BookData, "createdAt" | "updatedAt"> { createdAt: string; updatedAt: string; }

export class BookRepository {
  public constructor(private readonly database: IndexedDbService) {}
  public async save(book: Book): Promise<void> {
    await this.database.request(STORE_NAMES.books, "readwrite", (store) => store.put(this.serialize(book)));
  }
  public async get(id: string): Promise<Book | null> {
    const data = await this.database.request<StoredBook | undefined>(STORE_NAMES.books, "readonly", (store) => store.get(id));
    return data ? this.deserialize(data) : null;
  }
  public async getAll(): Promise<Book[]> {
    return (await this.database.getAll<StoredBook>(STORE_NAMES.books)).map((book) => this.deserialize(book));
  }
  public async getByGenre(genreId: string): Promise<Book[]> {
    const database = await this.database.open();
    const rows = await new Promise<StoredBook[]>((resolve, reject) => {
      const request = database.transaction(STORE_NAMES.books).objectStore(STORE_NAMES.books).index("genreId").getAll(genreId);
      request.onsuccess = () => resolve(request.result as StoredBook[]); request.onerror = () => reject(request.error);
    });
    return rows.map((book) => this.deserialize(book));
  }
  public async delete(id: string): Promise<void> {
    await this.database.request(STORE_NAMES.books, "readwrite", (store) => store.delete(id));
  }
  private serialize(book: Book): StoredBook {
    return { id: book.id, title: book.title, author: book.author, genreId: book.genreId, cover: book.cover,
      fileType: book.fileType, fileName: book.fileName, fileSize: book.fileSize, mimeType: book.mimeType,
      readingStatus: book.readingStatus, createdAt: book.createdAt.toISOString(), updatedAt: book.updatedAt.toISOString(),
      currentLocation: book.currentLocation, progressPercent: book.progressPercent, collectionId: book.collectionId,conversionStatus:book.conversionStatus,availability:book.availability,volume:book.volume,summary:book.summary,description:book.description,publicationYear:book.publicationYear,series:book.series,documentMode:book.documentMode,textCapability:book.textCapability,limaCapability:book.limaCapability,offlineAvailability:book.offlineAvailability,contentType:book.contentType,collectionPath:book.collectionPath,catalogBookId:book.catalogBookId,source:book.source };
  }
  private deserialize(data: StoredBook): Book {
    return new Book({ ...data, createdAt: new Date(data.createdAt), updatedAt: new Date(data.updatedAt) });
  }
}
