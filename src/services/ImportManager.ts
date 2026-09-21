import type { ImportedFile } from "../importers/BookImporter";
import { LocalFileImporter } from "../importers/LocalFileImporter";
import type { GoogleDriveImporter } from "../importers/GoogleDriveImporter";
import type { UrlImporter } from "../importers/UrlImporter";
import { Book, type ReadingStatus, type BookDocumentMode, type BookTextCapability, type BookLimaCapability, type BookContentType } from "../models/Book";
import { BookRepository } from "../repositories/BookRepository";
import { LimaDocumentRepository } from "../repositories/LimaDocumentRepository";
import { LimaConversionManager } from "../lima/LimaConversionManager";
import type{LimaConversionProgress}from"../lima/LimaConverter";
import type{DesktopLibraryFolderService}from"./DesktopLibraryFolderService";
import{LimaSerializer}from"../lima/LimaSerializer";import type{LibraryChecksumRepository}from"../repositories/LibraryChecksumRepository";
import { DuplicateBookDetector, type DuplicateDecision, type IncomingBookIdentity } from "../storage/DuplicateBookDetector";
import type { OperationRecoveryJournal } from "../recovery/OperationRecoveryJournal";
import { checkCancelled } from "../external/OneDriveError";
import { BookDownloadError, StartTelemetry } from "../diagnostics/StartTelemetry";

interface BookFileStorage { save(bookId:string,file:Blob):Promise<unknown>; delete(bookId:string):Promise<unknown>; get?(bookId:string):Promise<Blob|null>; saveLima?(bookId:string,file:Blob):Promise<unknown>; }

export interface ImportMetadata { title: string; author: string; genreId: string; contentType?: BookContentType; collectionPath?: string; collectionId?: string; readingStatus: ReadingStatus; cover: string; volume?: string; series?: string; description?: string; publicationYear?: number; documentMode?: BookDocumentMode; textCapability?: BookTextCapability; limaCapability?: BookLimaCapability; }
export interface SaveImportOptions { allowPossibleVersion?: boolean; replaceBookId?: string; bookId?: string; signal?: AbortSignal; journal?: OperationRecoveryJournal; operationId?: string; catalogBookId?: string; }
export class DuplicateBookImportError extends Error { public constructor(public readonly decision: Extract<DuplicateDecision,{kind:"duplicate"}>) { super("Este livro já está na sua biblioteca."); } }
export class BookVersionConflictError extends Error { public constructor(public readonly decision: Extract<DuplicateDecision,{kind:"possible-version"}>) { super("Já existe outra versão deste livro na biblioteca."); } }

export class ImportManager {
  private readonly duplicates = new DuplicateBookDetector();
  public constructor(private readonly importer: LocalFileImporter, private readonly books: BookRepository, private readonly files: BookFileStorage,
    private readonly googleDrive?: GoogleDriveImporter, private readonly urlImporter?: UrlImporter,private readonly limaDocuments?:LimaDocumentRepository,private readonly desktopFolder?:DesktopLibraryFolderService,private readonly checksums?:LibraryChecksumRepository) {}
  public select(file: File): Promise<ImportedFile> { return this.importer.import(file); }
  public selectGoogleDrive(folderId?: string, onProgress?: (percent: number | null) => void): Promise<ImportedFile> {
    if (!this.googleDrive) throw new Error("A importação do Google Drive não está configurada.");
    return this.googleDrive.selectFile(folderId, onProgress);
  }
  public selectUrl(url: string, onProgress?: (percent: number | null) => void): Promise<ImportedFile> {
    if (!this.urlImporter) throw new Error("A importação por link não está configurada.");
    return this.urlImporter.importFromUrl(url, onProgress);
  }
  public async inspect(imported: ImportedFile, metadata: Pick<ImportMetadata,"title"|"author"|"volume"|"series"|"publicationYear">): Promise<DuplicateDecision> {
    const identity = await this.identity(imported, metadata);
    return this.duplicates.classify(await this.books.getAll(), await this.existingHashes(), identity);
  }
  public async save(imported: ImportedFile, metadata: ImportMetadata,onConversionProgress?:(value:LimaConversionProgress)=>void,options:SaveImportOptions={}): Promise<Book> {
    checkCancelled(options.signal);
    await this.assertCapacity(imported.file.size);
    const decision = await this.inspect(imported, metadata);
    if (decision.kind === "duplicate" && !options.replaceBookId) throw new DuplicateBookImportError(decision);
    if (decision.kind === "possible-version" && !options.allowPossibleVersion && !options.replaceBookId) throw new BookVersionConflictError(decision);
    const now = new Date();
    const book = new Book({ id: options.replaceBookId ?? options.bookId ?? crypto.randomUUID(), ...metadata, fileType: imported.fileType,
      fileName: imported.file.name, fileSize: imported.file.size, mimeType: imported.file.type,
      createdAt: now, updatedAt: now, catalogBookId: options.catalogBookId, source: imported.source });
    checkCancelled(options.signal);
    const fromGoogle = imported.source === "google-drive";
    if (fromGoogle) StartTelemetry.request(book.id, undefined, "SAVING");
    if (options.journal && options.operationId) await options.journal.attachBook(options.operationId, book.id);
    try {
      await this.files.save(book.id, imported.file); checkCancelled(options.signal);
      book.offlineAvailability = "AVAILABLE";
      await this.books.save(book);
      await this.checksums?.save({ bookId: book.id, source: await this.checksum(imported.file) });
      if (this.limaDocuments) {
        const conversion = new LimaConversionManager(this.limaDocuments, this.books);
        const cancel = (): void => conversion.cancel();
        options.signal?.addEventListener("abort", cancel, { once: true });
        try { checkCancelled(options.signal); await conversion.convert(book, imported.file, onConversionProgress); }
        finally { options.signal?.removeEventListener("abort", cancel); }
        checkCancelled(options.signal);
        const document = await this.limaDocuments.get(book.id);
        if (document) {
          const bytes = new LimaSerializer().serialize(document), blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/x-lima-book" });
          await this.files.saveLima?.(book.id, blob);
          // Remote imports commit to local app storage first. They do not write
          // an external folder during a cancellable transaction.
          if (imported.source !== "onedrive") await Promise.all([this.desktopFolder?.save(document), this.desktopFolder?.saveOriginal(document, imported.file, book.fileType)]);
          await this.checksums?.save({ bookId: book.id, source: await this.checksum(imported.file), lima: await this.checksum(blob) });
        }
        // Original PDF/EPUB remains readable even when optional reflow fails.
        book.availability = "AVAILABLE"; book.offlineAvailability = "AVAILABLE";
        await this.books.save(book);
      }
      checkCancelled(options.signal);
      if (options.journal && options.operationId) await options.journal.complete(options.operationId);
      return book;
    } catch (error) {
      await Promise.all([this.books.delete(book.id), this.files.delete(book.id), this.limaDocuments?.delete(book.id), this.checksums?.delete(book.id)]);
      if (fromGoogle && !(error instanceof DuplicateBookImportError) && !(error instanceof BookVersionConflictError)) {
        const typed = error instanceof BookDownloadError ? error : new BookDownloadError("INDEXEDDB_SAVE_FAILED", "SAVING", book.id, undefined, false, error);
        StartTelemetry.failed(book.id, undefined, "SAVING", error); throw typed;
      }
      throw error;
    }
  }
  private async assertCapacity(fileSize: number): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return;
    const estimate = await navigator.storage.estimate();
    if (estimate.quota !== undefined && estimate.usage !== undefined && fileSize > estimate.quota - estimate.usage) {
      throw new Error("Não há espaço disponível suficiente para importar este livro.");
    }
  }
  private async checksum(blob:Blob):Promise<string>{const digest=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());return[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("");}
  private async identity(imported:ImportedFile,metadata:Pick<ImportMetadata,"title"|"author"|"volume"|"series"|"publicationYear">):Promise<IncomingBookIdentity>{
    return { title: metadata.title.trim(), author: metadata.author.trim(), volume: metadata.volume, series: metadata.series, publicationYear: metadata.publicationYear,
      fileName: imported.file.name, fileSize: imported.file.size, hash: await this.checksum(imported.file) };
  }
  private async existingHashes():Promise<ReadonlyMap<string,string>>{
    const books=await this.books.getAll(), values=new Map<string,string>();
    await Promise.all(books.map(async book=>{const stored=await this.checksums?.get(book.id);if(stored?.source){values.set(book.id,stored.source);return;}
      if(this.files.get&&book.fileSize>0){const blob=await this.files.get(book.id);if(blob&&blob.size===book.fileSize)values.set(book.id,await this.checksum(blob));}}));
    return values;
  }
}
