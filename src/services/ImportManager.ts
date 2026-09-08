import type { ImportedFile } from "../importers/BookImporter";
import { LocalFileImporter } from "../importers/LocalFileImporter";
import type { GoogleDriveImporter } from "../importers/GoogleDriveImporter";
import type { UrlImporter } from "../importers/UrlImporter";
import { Book, type ReadingStatus } from "../models/Book";
import { BookRepository } from "../repositories/BookRepository";
import { LimaDocumentRepository } from "../repositories/LimaDocumentRepository";
import { LimaConversionManager } from "../lima/LimaConversionManager";
import type{LimaConversionProgress}from"../lima/LimaConverter";
import type{DesktopLibraryFolderService}from"./DesktopLibraryFolderService";
import{LimaSerializer}from"../lima/LimaSerializer";import type{LibraryChecksumRepository}from"../repositories/LibraryChecksumRepository";
import { DuplicateBookDetector, type DuplicateDecision, type IncomingBookIdentity } from "../storage/DuplicateBookDetector";

interface BookFileStorage { save(bookId:string,file:Blob):Promise<unknown>; delete(bookId:string):Promise<unknown>; get?(bookId:string):Promise<Blob|null>; saveLima?(bookId:string,file:Blob):Promise<unknown>; }

export interface ImportMetadata { title: string; author: string; genreId: string; collectionId?: string; readingStatus: ReadingStatus; cover: string; volume?: string; series?: string; publicationYear?: number; }
export interface SaveImportOptions { allowPossibleVersion?: boolean; replaceBookId?: string; }
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
    await this.assertCapacity(imported.file.size);
    const decision = await this.inspect(imported, metadata);
    if (decision.kind === "duplicate") throw new DuplicateBookImportError(decision);
    if (decision.kind === "possible-version" && !options.allowPossibleVersion && !options.replaceBookId) throw new BookVersionConflictError(decision);
    const now = new Date();
    const book = new Book({ id: crypto.randomUUID(), ...metadata, fileType: imported.fileType,
      fileName: imported.file.name, fileSize: imported.file.size, mimeType: imported.file.type,
      createdAt: now, updatedAt: now });
    await this.files.save(book.id, imported.file);
    book.offlineAvailability="AVAILABLE";
    try { await this.books.save(book); }
    catch (error) { await this.files.delete(book.id); throw error; }
    await this.checksums?.save({ bookId: book.id, source: await this.checksum(imported.file) });
    if(this.limaDocuments){await new LimaConversionManager(this.limaDocuments,this.books).convert(book,imported.file,onConversionProgress);const document=await this.limaDocuments.get(book.id);if(document){const bytes=new LimaSerializer().serialize(document),limaBlob=new Blob([bytes as Uint8Array<ArrayBuffer>],{type:"application/x-lima-book"});await this.files.saveLima?.(book.id,limaBlob);await Promise.all([this.desktopFolder?.save(document),this.desktopFolder?.saveOriginal(document,imported.file,book.fileType)]);await this.checksums?.save({bookId:book.id,source:await this.checksum(imported.file),lima:await this.checksum(limaBlob)});book.availability="AVAILABLE";book.offlineAvailability="AVAILABLE";}else{book.availability="INVALID_FILE";book.offlineAvailability="ERROR";}await this.books.save(book);}
    return book;
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
