export type BookFileType = "pdf" | "epub";
export type ReadingStatus = "unread" | "reading" | "finished";
export type LimaConversionStatus="notConverted"|"converting"|"ready"|"limited"|"failed";
export type BookAvailability="AVAILABLE"|"MISSING_FILE"|"INVALID_FILE";
export type BookOfflineAvailability="AVAILABLE"|"PARTIAL"|"REMOTE_ONLY"|"ERROR";
export type BookDocumentMode="native"|"mixed"|"scanned"|"unknown";
export type BookTextCapability="full"|"partial"|"none";
export type BookLimaCapability="full"|"limited"|"unavailable";
export type BookSource="device"|"google-drive"|"onedrive"|"url"|"catalog";
export type BookContentType="book"|"comic";

export interface BookData {
  id: string;
  title: string;
  author: string;
  genreId: string;
  cover: string;
  fileType: BookFileType;
  fileName: string;
  fileSize: number;
  mimeType: string;
  readingStatus: ReadingStatus;
  createdAt?: Date;
  updatedAt?: Date;
  currentLocation?: string;
  progressPercent?: number;
  collectionId?: string;
  conversionStatus?:LimaConversionStatus;
  availability?:BookAvailability;
  volume?:string;
  summary?:string;description?:string;publicationYear?:number;series?:string;
  documentMode?:BookDocumentMode;textCapability?:BookTextCapability;limaCapability?:BookLimaCapability;
  offlineAvailability?:BookOfflineAvailability;
  /** Which reader opens this item. Absent means a regular book: existing PDFs are never
   *  reinterpreted as comics behind the reader's back. */
  contentType?: BookContentType;
  /** Drive folder ids from the collection root down to the folder this book came from,
   *  joined by "/". With catalogBookId ("<sourceId>:<driveFileId>") it is everything
   *  needed to reopen the book, and to walk back to where it was found, without listing
   *  the Drive tree again. */
  collectionPath?: string;
  /** Remote catalogue identity, retained only after the original file is local. */
  catalogBookId?: string;
  source?: BookSource;
}

export class Book {
  public readonly id: string;
  public readonly title: string;
  public readonly author: string;
  public readonly genreId: string;
  public readonly cover: string;
  public readonly fileType: BookFileType;
  public readonly fileName: string;
  public readonly fileSize: number;
  public readonly mimeType: string;
  public readingStatus: ReadingStatus;
  public readonly createdAt: Date;
  public updatedAt: Date;
  public currentLocation?: string;
  public progressPercent?: number;
  public readonly collectionId?: string;
  public conversionStatus:LimaConversionStatus;
  public availability:BookAvailability;
  public readonly volume?:string;
  public readonly summary?:string;public readonly description?:string;public readonly publicationYear?:number;public readonly series?:string;
  public documentMode:BookDocumentMode;public textCapability:BookTextCapability;public limaCapability:BookLimaCapability;
  public offlineAvailability:BookOfflineAvailability;
  public readonly contentType:BookContentType;
  public readonly collectionPath?:string;
  public readonly catalogBookId?:string;
  public readonly source:BookSource;

  public constructor(data: BookData) {
    this.id = data.id;
    this.title = data.title;
    this.author = data.author;
    this.genreId = data.genreId;
    this.cover = data.cover;
    this.fileType = data.fileType;
    this.fileName = data.fileName;
    this.fileSize = data.fileSize;
    this.mimeType = data.mimeType;
    this.readingStatus = data.readingStatus;
    this.createdAt = data.createdAt ?? new Date();
    this.updatedAt = data.updatedAt ?? new Date();
    this.currentLocation = data.currentLocation;
    this.progressPercent = data.progressPercent;
    this.collectionId = data.collectionId;
    this.conversionStatus=data.conversionStatus??"notConverted";
    this.availability=data.availability??"AVAILABLE";
    this.volume=data.volume;
    this.summary=data.summary;this.description=data.description;this.publicationYear=data.publicationYear;this.series=data.series;
    this.documentMode=data.documentMode??"unknown";this.textCapability=data.textCapability??"partial";this.limaCapability=data.limaCapability??"limited";
    this.offlineAvailability=data.offlineAvailability??(this.availability==="AVAILABLE"?"AVAILABLE":"ERROR");
    this.contentType=data.contentType??"book";
    this.collectionPath=data.collectionPath;
    this.catalogBookId=data.catalogBookId;this.source=data.source??"device";
  }
}
