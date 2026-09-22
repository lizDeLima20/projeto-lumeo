import { LocalFileImporter } from "../importers/LocalFileImporter";
import type { Book } from "../models/Book";
import type { CatalogDownloadProgress, CatalogDownloadService } from "./CatalogDownloadService";
import type { CatalogDownloadLink } from "./CatalogService";
import type { CoverService } from "./CoverService";
import type { DriveFolderEntry, DriveFolderListing } from "./DriveCollectionService";
import type { ImportManager } from "./ImportManager";
import { ComicCollectionTrail } from "../reader/comic/ComicCollectionTrail";

export class CollectionFormatUnsupportedError extends Error {
  public readonly code = "COLLECTION_FORMAT_UNSUPPORTED";
  public constructor(public readonly format: string) { super("Este formato ainda não pode ser adicionado à biblioteca."); }
}

/** The file the reader picked is not the comic this page is about. */
export class CollectionFileMismatchError extends Error {
  public readonly code = "IMPORT_FILE_INVALID";
  public constructor() { super("O arquivo selecionado não corresponde a esta HQ."); }
}

export interface CollectionImportRequest {
  collectionId: string;
  entry: DriveFolderEntry;
  listing: Pick<DriveFolderListing, "folderId" | "breadcrumb">;
  genreId: string;
  cover?: string;
}
export type CollectionDownloadResult =
  | { kind: "native-file"; file: File }
  | { kind: "browser-download"; expectedFilename: string };
export type CollectionImportResult =
  | { kind: "saved"; book: Book }
  | { kind: "existing"; book: Book }
  | { kind: "browser-download"; expectedFilename: string };

/** Looks a comic up in the library by its identity. */
export type LibraryLookup = (catalogBookId: string) => Book | undefined;

/** Brings one file from a published collection into the library, over the same rails every
 *  other Lumeo book uses: the platform download service, then ImportManager, which owns
 *  storage and the Book record.
 *
 *  Downloading and adding are two steps, as they are for catalogue books: a phone gets the
 *  file from the native downloader, a browser downloads it and hands it back.
 *
 *  A comic's identity is its collection and its Drive file id - never its title. Nearly
 *  every file in the Marvel tree is called "Capítulo 01", "Capítulo 02"..., and the book
 *  importer's title heuristic took the Deadpool "Capítulo 01" for another version of the
 *  Fênix one and refused it: only the first comic ever reached the shelf. */
export class CollectionImportService {
  public constructor(
    private readonly downloads: CatalogDownloadService,
    private readonly imports: ImportManager,
    private readonly covers: CoverService,
    private readonly library: LibraryLookup = () => undefined,
    private readonly importer = new LocalFileImporter(),
  ) {}

  public identity(request: Pick<CollectionImportRequest, "collectionId" | "entry">): string {
    return `${request.collectionId}:${request.entry.id}`;
  }

  /** The comic already in the library, if it is there with its file. */
  public existing(request: Pick<CollectionImportRequest, "collectionId" | "entry">): Book | undefined {
    const book = this.library(this.identity(request));
    return book?.availability === "AVAILABLE" ? book : undefined;
  }

  /** Real files in the collection are often named "Capítulo 01", with no extension at all.
   *  The download pipeline and the importer both key off the filename, so the title gets
   *  the extension its own mimeType already proves it has. */
  public filename(entry: DriveFolderEntry): string {
    const format = this.assertReadable(entry);
    return /\.(pdf|epub)$/i.test(entry.name.trim()) ? entry.name.trim() : `${entry.name.trim()}.${format}`;
  }

  /** "Capítulo 01" alone says nothing on a shelf; the arc it belongs to does. */
  public title(entry: DriveFolderEntry, listing: Pick<DriveFolderListing, "breadcrumb">): string {
    const file = entry.name.replace(/\.(pdf|epub)$/i, "").trim() || entry.name.trim();
    const parent = listing.breadcrumb.length > 1 ? listing.breadcrumb[listing.breadcrumb.length - 1]!.name.trim() : "";
    return parent && !file.toLocaleLowerCase().includes(parent.toLocaleLowerCase()) ? `${parent} — ${file}` : file;
  }

  public link(request: CollectionImportRequest): CatalogDownloadLink {
    const entry = request.entry;
    const format = this.assertReadable(entry);
    const filename = this.filename(entry);
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(entry.id)}`;
    return {
      bookId: this.identity(request),
      driveFileId: entry.id,
      downloadUrl, downloadUrls: [downloadUrl],
      title: this.title(entry, request.listing), author: "", genreId: request.genreId, genreName: "",
      format, sha256: null, coverUrl: null, fileSize: entry.size,
      filename, expectedFilename: filename, expiresAt: null,
    };
  }

  /** Step one. On Android the file comes back from private storage; in a browser it lands in
   *  Downloads and the reader hands it back in step two. */
  public async download(request: CollectionImportRequest, onProgress?: CatalogDownloadProgress, signal?: AbortSignal): Promise<CollectionDownloadResult> {
    const link = this.link(request);
    const receipt = await this.downloads.download(link, onProgress, signal);
    return receipt.kind === "native-file" ? { kind: "native-file", file: receipt.file } : { kind: "browser-download", expectedFilename: link.expectedFilename };
  }

  /** Both steps at once, for callers that do not stop between them. */
  public async add(request: CollectionImportRequest, onProgress?: CatalogDownloadProgress, signal?: AbortSignal): Promise<CollectionImportResult> {
    const existing = this.existing(request);
    if (existing) return { kind: "existing", book: existing };
    const downloaded = await this.download(request, onProgress, signal);
    if (downloaded.kind === "browser-download") return downloaded;
    return this.addDownloadedFile(request, downloaded.file, signal);
  }

  /** Step two: puts a downloaded file in the library as this comic. A file picked by hand is
   *  checked against the Drive metadata first, so the wrong PDF cannot take this comic's
   *  place. Adding the same comic twice returns the book already there. */
  public async addDownloadedFile(request: CollectionImportRequest, file: File, signal?: AbortSignal): Promise<CollectionImportResult> {
    const existing = this.existing(request);
    if (existing) return { kind: "existing", book: existing };
    const entry = request.entry;
    this.assertReadable(entry);
    this.assertMatches(entry, file);
    const named = file.name === this.filename(entry) ? file : new File([file], this.filename(entry), { type: entry.mimeType || file.type });
    const imported = await this.importer.import(named, "google-drive");
    if (imported.fileType !== entry.format) throw new CollectionFileMismatchError();
    const title = this.title(entry, request.listing);
    // The cover is the comic's own first page, taken from the file itself: it is the page
    // Drive shows as the thumbnail, and it stays with the book offline.
    const cover = request.cover ?? await this.covers.fromBookFile(imported.file, imported.fileType, title);
    const trail = ComicCollectionTrail.fromBreadcrumb(request.listing.breadcrumb);
    const book = await this.imports.save(imported, {
      title, author: "", genreId: request.genreId, collectionId: request.collectionId, readingStatus: "unread", cover,
      contentType: entry.contentType ?? "comic",
      collectionPath: trail.serialize(),
      series: trail.collection ?? undefined,
    }, undefined, {
      signal, catalogBookId: this.identity(request),
      // The identity above is exact, so the importer's fuzzy "same title, another edition?"
      // check is not the question here. An identical file is still caught by its hash.
      allowPossibleVersion: true,
    });
    return { kind: "saved", book };
  }

  /** Drive already told us the file's size; a browser download of that file has exactly
   *  that size, whatever the browser named it. The name is only a fallback. */
  public matches(entry: DriveFolderEntry, file: File): boolean {
    if (entry.size !== null && entry.size !== undefined && entry.size > 0) return file.size === entry.size;
    const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase()
      .replace(/\s*\(\d+\)(?=\.[^.]+$)/, "").replace(/\.(pdf|epub)$/i, "").replace(/[^a-z0-9]+/g, "");
    return normalize(file.name) === normalize(this.filename(entry));
  }

  private assertMatches(entry: DriveFolderEntry, file: File): void {
    if (!this.matches(entry, file)) throw new CollectionFileMismatchError();
  }

  /** CBR is listed and named, but it cannot enter the library while no reader can open it. */
  private assertReadable(entry: DriveFolderEntry): "pdf" | "epub" {
    if (entry.kind !== "file" || !entry.supported || (entry.format !== "pdf" && entry.format !== "epub")) {
      throw new CollectionFormatUnsupportedError(entry.format ?? "unknown");
    }
    return entry.format;
  }
}
