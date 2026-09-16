export const STORE_NAMES = {
  books: "books",
  genres: "genres",
  files: "bookFiles",
  progress: "readingProgress",
  collections: "collections",
  highlights: "highlights",
  annotations: "annotations",
  bookmarks: "bookmarks",
  studyLookupCache: "studyLookupCache",
  limaDocuments: "limaDocuments",
  chapterStudySheets: "chapterStudySheets",
  librarySettings: "librarySettings",
  libraryChecksums: "libraryChecksums",
  readerPreferences: "readerPreferences",
  imageReaderPreferences: "imageReaderPreferences",
  regionHighlights: "regionHighlights",
  metadataAuxiliary: "metadataAuxiliary",
  recoveryJournal: "recoveryJournal",
  localDiagnostics: "localDiagnostics",
  readingReviews: "readingReviews",
} as const;

export type StoreName = typeof STORE_NAMES[keyof typeof STORE_NAMES];
export type TransactionMode = "readonly" | "readwrite";

export class IndexedDbService {
  public static readonly SCHEMA_VERSION = 10;
  private connection: Promise<IDBDatabase> | null = null;
  public constructor(private readonly databaseName = "lumeo-library", private readonly version = IndexedDbService.SCHEMA_VERSION) {}

  public open(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;
    this.connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, this.version);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAMES.books)) {
          const books = database.createObjectStore(STORE_NAMES.books, { keyPath: "id" });
          books.createIndex("genreId", "genreId", { unique: false });
        }
        if (!database.objectStoreNames.contains(STORE_NAMES.genres)) database.createObjectStore(STORE_NAMES.genres, { keyPath: "id" });
        if (!database.objectStoreNames.contains(STORE_NAMES.files)) database.createObjectStore(STORE_NAMES.files, { keyPath: "bookId" });
        if (!database.objectStoreNames.contains(STORE_NAMES.progress)) database.createObjectStore(STORE_NAMES.progress, { keyPath: "bookId" });
        if (!database.objectStoreNames.contains(STORE_NAMES.collections)) database.createObjectStore(STORE_NAMES.collections, { keyPath: "id" });
        if (!database.objectStoreNames.contains(STORE_NAMES.highlights)) { const store=database.createObjectStore(STORE_NAMES.highlights,{keyPath:"id"});store.createIndex("bookId","bookId");store.createIndex("bookBlock",["bookId","blockId"]); }
        if (!database.objectStoreNames.contains(STORE_NAMES.annotations)) { const store=database.createObjectStore(STORE_NAMES.annotations,{keyPath:"id"});store.createIndex("bookId","bookId");store.createIndex("highlightId","highlightId"); }
        if (!database.objectStoreNames.contains(STORE_NAMES.bookmarks)) { const store=database.createObjectStore(STORE_NAMES.bookmarks,{keyPath:"id"});store.createIndex("bookId","bookId"); }
        if (!database.objectStoreNames.contains(STORE_NAMES.studyLookupCache)) database.createObjectStore(STORE_NAMES.studyLookupCache,{keyPath:"key"});
        if (!database.objectStoreNames.contains(STORE_NAMES.limaDocuments)) database.createObjectStore(STORE_NAMES.limaDocuments,{keyPath:"bookId"});
        if (!database.objectStoreNames.contains(STORE_NAMES.chapterStudySheets)) { const store=database.createObjectStore(STORE_NAMES.chapterStudySheets,{keyPath:"id"});store.createIndex("userBookChapter",["userId","bookId","chapterId"],{unique:true});store.createIndex("userBook",["userId","bookId"],{unique:false}); }
        if (!database.objectStoreNames.contains(STORE_NAMES.librarySettings)) database.createObjectStore(STORE_NAMES.librarySettings,{keyPath:"key"});
        if (!database.objectStoreNames.contains(STORE_NAMES.libraryChecksums)) database.createObjectStore(STORE_NAMES.libraryChecksums,{keyPath:"bookId"});
        if (!database.objectStoreNames.contains(STORE_NAMES.readerPreferences)) database.createObjectStore(STORE_NAMES.readerPreferences,{keyPath:"key"});
        if (!database.objectStoreNames.contains(STORE_NAMES.imageReaderPreferences)) database.createObjectStore(STORE_NAMES.imageReaderPreferences,{keyPath:"key"});
        if (!database.objectStoreNames.contains(STORE_NAMES.regionHighlights)) { const store=database.createObjectStore(STORE_NAMES.regionHighlights,{keyPath:"id"});store.createIndex("bookId","bookId"); }
        if (!database.objectStoreNames.contains(STORE_NAMES.metadataAuxiliary)) database.createObjectStore(STORE_NAMES.metadataAuxiliary,{keyPath:"bookId"});
        if (!database.objectStoreNames.contains(STORE_NAMES.recoveryJournal)) database.createObjectStore(STORE_NAMES.recoveryJournal,{keyPath:"id"});
        if (!database.objectStoreNames.contains(STORE_NAMES.localDiagnostics)) database.createObjectStore(STORE_NAMES.localDiagnostics,{keyPath:"id"});
        if (!database.objectStoreNames.contains(STORE_NAMES.readingReviews)) {
          const store=database.createObjectStore(STORE_NAMES.readingReviews,{keyPath:"id"});
          store.createIndex("userBook",["userId","bookId"],{unique:true});
          store.createIndex("bookId","bookId",{unique:false});
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir o armazenamento local."));
      request.onblocked = () => reject(new Error("Feche outras abas do Lumeo para atualizar o armazenamento."));
    });
    return this.connection;
  }

  public async request<T>(storeName: StoreName, mode: TransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = action(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(this.storageError(request.error));
      transaction.onabort = () => reject(this.storageError(transaction.error));
    });
  }

  public async getAll<T>(storeName: StoreName): Promise<T[]> {
    return this.request<T[]>(storeName, "readonly", (store) => store.getAll());
  }

  private storageError(error: DOMException | null): Error {
    if (error?.name === "QuotaExceededError") return new Error("Espaço insuficiente para salvar este livro no dispositivo.");
    return error ?? new Error("Falha no armazenamento local.");
  }
}
