import type { Book } from "../models/Book";
import { BookRepository } from "../repositories/BookRepository";
import { PdfPageRenderer, type ReaderStageSize } from "./PdfPageRenderer";
import { PdfReaderEngine, type PasswordProvider } from "./PdfReaderEngine";
import { ImagePageReaderEngine } from "./image/ImagePageReaderEngine";
import { DEFAULT_IMAGE_READER_PREFERENCES } from "./image/ImageReaderPreferences";
import { DocumentCapabilityMetadataService } from "./image/DocumentCapabilityMetadataService";
import { ReaderNavigationController, type NavigationReason } from "./ReaderNavigationController";
import { ReadingProgressService } from "./ReadingProgressService";
import { ReaderSettingsManager } from "./ReaderSettingsManager";
import type { ReadingProgress } from "../repositories/ReadingProgressRepository";
import type{LimaDocument}from"../lima/LimaDocument";import type{LimaDocumentRepository}from"../repositories/LimaDocumentRepository";

export class ReaderFileMissingError extends Error {}
export class EpubReaderUnavailableError extends Error {}
export interface ReaderPageState { currentPage: number; totalPages: number; reason: NavigationReason; book: Book; }
export interface ReaderSource {book:Book;blob:Blob;progress:ReadingProgress|null;lima:LimaDocument|null;}
interface ReaderFileStore { get(bookId:string):Promise<Blob|null>; }

export class ReaderManager {
  private readonly engine = new PdfReaderEngine();
  private readonly imageEngine = new ImagePageReaderEngine();
  private imageCanvas: HTMLCanvasElement | null = null;
  private renderer: PdfPageRenderer | null = null;
  private book: Book | null = null;
  private stageSize: (() => ReaderStageSize) | null = null;
  private onPageChange: ((state: ReaderPageState) => void) | null = null;
  public navigation: ReaderNavigationController | null = null;

  public constructor(private readonly books: BookRepository, private readonly files: ReaderFileStore,
    private readonly progress: ReadingProgressService, public readonly settings: ReaderSettingsManager,private readonly limaDocuments?:LimaDocumentRepository) {}

  public async open(bookId: string, canvas: HTMLCanvasElement, getStageSize: () => ReaderStageSize,
    passwordProvider: PasswordProvider, onPageChange: (state: ReaderPageState) => void): Promise<Book> {
    const book = await this.books.get(bookId);
    if (!book) throw new ReaderFileMissingError("Livro não encontrado na biblioteca local.");
    if (book.fileType === "epub") throw new EpubReaderUnavailableError("Leitor EPUB será implementado na próxima etapa.");
    const blob = await this.files.get(bookId);
    if (!blob) throw new ReaderFileMissingError("O arquivo PDF não está mais disponível neste dispositivo.");
    this.book = book; this.renderer = new PdfPageRenderer(canvas); this.stageSize = getStageSize; this.onPageChange = onPageChange;
    await this.engine.open(blob, passwordProvider);
    const restored = await this.progress.restoreProgress(bookId);
    this.navigation = new ReaderNavigationController(this.engine.totalPages, (page, reason) => this.renderPage(page, reason));
    await this.navigation.initialize(restored?.currentPage ?? 1); return this.book;
  }
  public async openImageReader(bookId:string,canvas:HTMLCanvasElement,getStageSize:()=>ReaderStageSize,passwordProvider:PasswordProvider,onPageChange:(state:ReaderPageState)=>void):Promise<Book>{const book=await this.books.get(bookId);if(!book)throw new ReaderFileMissingError("Livro não encontrado na biblioteca local.");const blob=await this.files.get(bookId);if(!blob)throw new ReaderFileMissingError("O arquivo PDF não está mais disponível neste dispositivo.");this.book=book;this.imageCanvas=canvas;this.stageSize=getStageSize;this.onPageChange=onPageChange;await this.imageEngine.open(blob,passwordProvider);const restored=await this.progress.restoreProgress(bookId);this.navigation=new ReaderNavigationController(this.imageEngine.totalPages,(page,reason)=>this.renderImagePage(page,reason));await this.navigation.initialize(restored?.currentPage??1);return book;}
  public async source(bookId:string):Promise<ReaderSource>{const book=await this.books.get(bookId);if(!book)throw new ReaderFileMissingError("Livro não encontrado na biblioteca local.");const blob=await this.files.get(bookId);if(!blob)throw new ReaderFileMissingError("O arquivo não está mais disponível neste dispositivo.");return{book,blob,progress:await this.progress.restoreProgress(bookId),lima:await this.limaDocuments?.get(bookId)??null};}
  public async saveReflow(book:Book,page:number,total:number,logicalOffset:number,reachedEnd=false,location?:string):Promise<Book>{this.book=await this.progress.saveProgress(book,page,total,reachedEnd,location??`logical:${logicalOffset}`);return this.book;}
  public async saveDocumentCapability(book:Book,capability:{documentMode:Book["documentMode"];textCapability:Book["textCapability"];limaCapability:Book["limaCapability"]}):Promise<Book>{const value=new DocumentCapabilityMetadataService().apply(book,capability);await this.books.save(value);return value;}

  public async rerender(): Promise<void> {
    if(this.imageCanvas&&this.navigation){await this.renderImageOnly(this.navigation.currentPage);return;}
    if (this.navigation) await this.renderOnly(this.navigation.currentPage);
  }
  public async close(): Promise<void> {
    this.renderer?.cancel(); await Promise.all([this.engine.close(),this.imageEngine.close()]); this.renderer = null; this.imageCanvas=null; this.book = null; this.navigation = null;
  }
  private async renderPage(pageNumber: number, reason: NavigationReason): Promise<void> {
    if (!await this.renderOnly(pageNumber)) return;
    if (!this.book || !this.navigation) return;
    this.book = await this.progress.saveProgress(this.book, pageNumber, this.navigation.totalPages,
      reason === "next" && pageNumber === this.navigation.totalPages);
    this.onPageChange?.({ currentPage: pageNumber, totalPages: this.navigation.totalPages, reason, book: this.book });
  }
  private async renderOnly(pageNumber: number): Promise<boolean> {
    if (!this.renderer || !this.stageSize) return false;
    return this.renderer.render(await this.engine.getPage(pageNumber), this.settings.settings, this.stageSize());
  }
  private async renderImagePage(pageNumber:number,reason:NavigationReason):Promise<void>{if(!await this.renderImageOnly(pageNumber))return;if(!this.book||!this.navigation)return;this.book=await this.progress.saveProgress(this.book,pageNumber,this.navigation.totalPages,reason==="next"&&pageNumber===this.navigation.totalPages);this.onPageChange?.({currentPage:pageNumber,totalPages:this.navigation.totalPages,reason,book:this.book});}
  private async renderImageOnly(pageNumber:number):Promise<boolean>{if(!this.imageCanvas||!this.stageSize)return false;return this.imageEngine.render(pageNumber,this.imageCanvas,this.settings.settings,this.stageSize(),DEFAULT_IMAGE_READER_PREFERENCES.scan);}
}
