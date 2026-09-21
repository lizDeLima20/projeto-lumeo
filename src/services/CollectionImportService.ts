import { LocalFileImporter } from "../importers/LocalFileImporter";
import type { Book } from "../models/Book";
import type { CatalogDownloadService } from "./CatalogDownloadService";
import type { CatalogDownloadLink } from "./CatalogService";
import type { CoverService } from "./CoverService";
import type { DriveFolderEntry, DriveFolderListing } from "./DriveCollectionService";
import type { ImportManager } from "./ImportManager";

export class CollectionFormatUnsupportedError extends Error {
  public readonly code = "COLLECTION_FORMAT_UNSUPPORTED";
  public constructor(public readonly format: string) { super("Este formato ainda não pode ser adicionado à biblioteca."); }
}

export interface CollectionImportRequest {
  collectionId: string;
  entry: DriveFolderEntry;
  listing: Pick<DriveFolderListing, "folderId" | "breadcrumb">;
  genreId: string;
}
export type CollectionImportResult =
  | { kind: "saved"; book: Book }
  | { kind: "browser-download"; expectedFilename: string };

/** Brings one file from a published collection into the library, over the same rails every
 *  other Lumeo book uses: the platform download service, then ImportManager, which owns
 *  storage, duplicate detection and the Book record.
 *
 *  Nothing about the library is reimplemented here. What this adds is the mapping from a
 *  Drive entry to those rails - and the two things the real collection made necessary: a
 *  filename that carries its extension, and contentType travelling with the book. */
export class CollectionImportService {
  public constructor(
    private readonly downloads: CatalogDownloadService,
    private readonly imports: ImportManager,
    private readonly covers: CoverService,
    private readonly importer = new LocalFileImporter(),
  ) {}

  /** Real files in the collection are often named "Capítulo 01", with no extension at all.
   *  The download pipeline and the importer both key off the filename, so the title gets
   *  the extension its own mimeType already proves it has. */
  public filename(entry: DriveFolderEntry): string {
    const format = this.assertReadable(entry);
    return /\.(pdf|epub)$/i.test(entry.name) ? entry.name : `${entry.name.trim()}.${format}`;
  }

  public link(request: CollectionImportRequest): CatalogDownloadLink {
    const entry = request.entry;
    const format = this.assertReadable(entry);
    const filename = this.filename(entry);
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(entry.id)}`;
    return {
      bookId: `${request.collectionId}:${entry.id}`,
      driveFileId: entry.id,
      downloadUrl, downloadUrls: [downloadUrl],
      title: this.title(entry), author: "", genreId: request.genreId, genreName: "",
      format, sha256: null, coverUrl: null, fileSize: entry.size,
      filename, expectedFilename: filename, expiresAt: null,
    };
  }

  public async add(request: CollectionImportRequest, onProgress?: (bytes: number, total: number | null) => void, signal?: AbortSignal): Promise<CollectionImportResult> {
    const link = this.link(request);
    const receipt = await this.downloads.download(link, onProgress, signal);
    if (receipt.kind === "browser-download") return { kind: "browser-download", expectedFilename: link.expectedFilename };
    return { kind: "saved", book: await this.save(request, receipt.file, signal) };
  }

  /** The web path: the browser downloaded the file and the reader hands it back. */
  public async addDownloadedFile(request: CollectionImportRequest, file: File, signal?: AbortSignal): Promise<Book> {
    return this.save(request, file, signal);
  }

  private async save(request: CollectionImportRequest, file: File, signal?: AbortSignal): Promise<Book> {
    const entry = request.entry;
    this.assertReadable(entry);
    const named = file.name === this.filename(entry) ? file : new File([file], this.filename(entry), { type: entry.mimeType || file.type });
    const imported = await this.importer.import(named, "google-drive");
    // The cover is the book's own first page, extracted from the file just downloaded.
    const cover = await this.covers.fromBookFile(imported.file, imported.fileType, this.title(entry));
    return this.imports.save(imported, {
      title: this.title(entry), author: "", genreId: request.genreId, readingStatus: "unread", cover,
      contentType: entry.contentType ?? "comic",
      collectionPath: request.listing.breadcrumb.map(step => step.id).join("/"),
      series: request.listing.breadcrumb.length > 1 ? request.listing.breadcrumb[request.listing.breadcrumb.length - 1]!.name : undefined,
    }, undefined, { signal, catalogBookId: `${request.collectionId}:${entry.id}` });
  }

  private title(entry: DriveFolderEntry): string {
    return entry.name.replace(/\.(pdf|epub)$/i, "").trim() || entry.name;
  }

  /** CBR is listed and named, but it cannot enter the library while no reader can open it. */
  private assertReadable(entry: DriveFolderEntry): "pdf" | "epub" {
    if (entry.kind !== "file" || !entry.supported || (entry.format !== "pdf" && entry.format !== "epub")) {
      throw new CollectionFormatUnsupportedError(entry.format ?? "unknown");
    }
    return entry.format;
  }
}
