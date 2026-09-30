import { Archive } from "libarchive.js/dist/libarchive-node.mjs";
import sharp from "sharp";
import { extractCbzCoverAndInfo } from "../../../shared/CbzFirstPageExtractor.js";
import { comicPageCollator, isComicPageImagePath, isSafeArchivePath, sniffComicPageMime } from "../../../shared/ComicArchiveEntryFilter.js";
import type { DriveCollectionService } from "./DriveCollectionService.js";
import type { DriveFolderEntry } from "./types.js";

/** The one authenticated Drive capability this needs: the same service account already
 * trusted to browse a collection's folders, reading either one byte range or the whole
 * file. Never the public, CORS-hostile download link. */
export interface DriveMediaSource {
  mediaRange(fileId: string, range?: string): Promise<Response>;
}

export interface ComicCoverMetadata {
  title: string | null;
  series: string | null;
  number: string | null;
  year: string | null;
  summary: string | null;
  writer: string | null;
  publisher: string | null;
  genre: string | null;
}

export interface ComicCoverResult {
  image: Buffer;
  contentType: "image/jpeg";
  etag: string;
  metadata: ComicCoverMetadata;
}

type ArchiveFile = { name: string; size: number; extract(): Promise<File> };
type ArchiveEntryRow = { path: string; file: ArchiveFile };
type ArchiveReaderLike = Pick<Awaited<ReturnType<typeof Archive.open>>, "getFilesArray" | "hasEncryptedData" | "close">;

const EMPTY_METADATA: ComicCoverMetadata = {
  title: null, series: null, number: null, year: null, summary: null, writer: null, publisher: null, genre: null,
};

/** A comic archive this large is refused before it is ever downloaded whole - real CBR/CBZ
 * covers a few hundred MB at most, and a serverless instance has neither the memory nor the
 * time budget to hold anything past that just to find one page. */
const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024;
/** One request's whole budget for downloading, opening and resizing an archive - comfortably
 * inside Vercel's own function timeout, so a slow or stuck extraction fails the one request
 * instead of the instance. */
const EXTRACTION_TIMEOUT_MS = 25_000;
/** Card-sized, at roughly twice the client's own 320x452 CSS size for retina screens -
 * nowhere near a real comic page's native resolution. */
const THUMBNAIL_MAX_WIDTH = 640;
const THUMBNAIL_MAX_HEIGHT = 904;
const JPEG_QUALITY = 82;
/** How many archives this warm instance will open at once. A burst of cards revealed by one
 * scroll must not let a single request starve the CPU/memory a Vercel function is billed by. */
const MAX_CONCURRENT_EXTRACTIONS = 2;

/** Resolves the cover of one CBR/CBZ, on demand, for the narrow case a Drive-rendered
 * thumbnail does not already cover it. Nothing here is persisted: every call downloads (or
 * range-reads) straight from Drive, generates one small JPEG, and discards the archive.
 *
 * Every fileId this is ever asked about is first proven to belong to the collection by
 * replaying the exact same folder-open validation the reader's own navigation already uses
 * (DriveCollectionService.open) - this service has no separate notion of "which files are
 * allowed", and accepts no client-supplied URL. */
export class ComicCoverThumbnailService {
  private running = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly inFlight = new Map<string, Promise<ComicCoverResult | null>>();

  public constructor(
    private readonly collections: DriveCollectionService,
    private readonly drive: DriveMediaSource,
    private readonly openArchive: (file: File) => Promise<ArchiveReaderLike> = (file) => Archive.open(file),
  ) {}

  /** `path` is the same root-to-file id trail the client already carries on every entry
   * (DriveFolderEntry.collectionPath) - its last step must be `fileId`, and every step
   * before that is handed straight to DriveCollectionService.open() to prove the file's
   * parent folder really is inside this collection's authorized Drive roots. */
  public async thumbnail(collectionId: string, fileId: string, path: readonly string[]): Promise<ComicCoverResult | null> {
    const entry = await this.resolveEntry(collectionId, fileId, path);
    if (!entry || (entry.format !== "cbr" && entry.format !== "cbz")) return null;
    const key = `${entry.id}:${entry.modifiedAt ?? "unknown"}`;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const work = this.runQueued(entry);
    this.inFlight.set(key, work);
    void work.finally(() => this.inFlight.delete(key));
    return work;
  }

  private async resolveEntry(collectionId: string, fileId: string, path: readonly string[]): Promise<DriveFolderEntry | null> {
    if (!fileId.trim() || path.length < 2 || path[path.length - 1] !== fileId) return null;
    const folderPath = path.slice(0, -1);
    const folderId = folderPath[folderPath.length - 1];
    if (!folderId) return null;
    const listing = await this.collections.open(collectionId, folderId, folderPath);
    return listing.entries.find(item => item.id === fileId && item.kind === "file") ?? null;
  }

  private async runQueued(entry: DriveFolderEntry): Promise<ComicCoverResult | null> {
    await this.acquire();
    try { return await this.withTimeout(this.generate(entry)); }
    catch (error) { this.log("COMIC_COVER_FAILED", { fileId: entry.id, format: entry.format, stage: "runQueued", ...this.describeError(error) }); return null; }
    finally { this.release(); }
  }

  private acquire(): Promise<void> {
    if (this.running < MAX_CONCURRENT_EXTRACTIONS) { this.running++; return Promise.resolve(); }
    return new Promise(resolve => this.waiting.push(() => { this.running++; resolve(); }));
  }

  private release(): void {
    this.running--;
    const next = this.waiting.shift();
    next?.();
  }

  private async withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("comic cover generation timed out")), EXTRACTION_TIMEOUT_MS);
    });
    try { return await Promise.race([work, timeout]); }
    finally { clearTimeout(timer!); }
  }

  private async generate(entry: DriveFolderEntry): Promise<ComicCoverResult | null> {
    const extracted = entry.format === "cbz" ? await this.fromCbz(entry) : await this.fromFullArchive(entry);
    if (!extracted?.page) { this.log("COMIC_COVER_FAILED", { fileId: entry.id, format: entry.format, stage: "extract" }); return null; }
    const image = await this.resize(extracted.page);
    if (!image) { this.log("COMIC_COVER_FAILED", { fileId: entry.id, format: entry.format, stage: "resize" }); return null; }
    return {
      image, contentType: "image/jpeg", etag: `"${entry.id}-${entry.modifiedAt ?? "unknown"}"`,
      metadata: extracted.comicInfoXml ? parseComicInfo(extracted.comicInfoXml) : EMPTY_METADATA,
    };
  }

  /** Range-reads only the ZIP's own directory structure and the first page's compressed
   * bytes, never the archive itself. Falls back to a full download only for the rare CBZ
   * whose size Drive did not report, or whose directory this narrow ZIP reader could not
   * make sense of. */
  private async fromCbz(entry: DriveFolderEntry): Promise<{ page: Blob | null; comicInfoXml: string | null } | null> {
    if (entry.size) {
      const result = await extractCbzCoverAndInfo(entry.size, (start, end) => this.rangeFetch(entry.id, start, end))
        .catch((error: unknown) => { this.log("COMIC_COVER_FAILED", { fileId: entry.id, format: "cbz", stage: "range-extract", ...this.describeError(error) }); return { page: null, comicInfoXml: null }; });
      if (result.page) return result;
      this.log("COMIC_COVER_FALLBACK", { fileId: entry.id, format: "cbz", reason: "range-extract-empty" });
    }
    return this.fromFullArchive(entry);
  }

  private async rangeFetch(fileId: string, start: number, end: number): Promise<Uint8Array> {
    const response = await this.drive.mediaRange(fileId, `bytes=${start}-${end}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // Some responses ignore the Range header and answer with the whole file (200) instead
    // of the slice (206) - sliced here so the extractor's own offset math still gets
    // exactly the bytes it asked for, regardless of what Drive actually sent back.
    return response.status === 206 ? bytes : bytes.subarray(start, end + 1);
  }

  /** CBR always needs the whole archive - RAR keeps no equivalent of a ZIP central
   * directory this reader can exploit. Reuses the same libarchive.js build already bundled
   * for the real reader, through its dedicated Node entry point instead of the browser
   * Worker one, and discards the downloaded bytes and the opened archive the moment the one
   * page (and ComicInfo.xml, if present) are out. */
  private async fromFullArchive(entry: DriveFolderEntry): Promise<{ page: Blob | null; comicInfoXml: string | null } | null> {
    const buffer = await this.download(entry.id, entry.size);
    const archive = await this.openArchive(new File([new Uint8Array(buffer)], entry.format === "cbr" ? "comic.cbr" : "comic.cbz"));
    try {
      if (await archive.hasEncryptedData()) { this.log("COMIC_COVER_FAILED", { fileId: entry.id, format: entry.format, stage: "archive-open", reason: "encrypted" }); return null; }
      const listed = await archive.getFilesArray() as ArchiveEntryRow[];
      const rows = listed
        .map(item => ({ path: `${item.path}${item.file.name}`.replace(/\\/g, "/"), file: item.file }))
        .filter(item => isSafeArchivePath(item.path));
      // libarchive's own listing order is whatever the archive stored, not natural order -
      // the exact same natural-sort collator the real reader uses picks the same "page one".
      const pages = rows.filter(item => isComicPageImagePath(item.path)).sort((a, b) => comicPageCollator.compare(a.path, b.path));
      if (!pages.length) this.log("COMIC_COVER_FAILED", { fileId: entry.id, format: entry.format, stage: "archive-open", reason: "no-page-entries", entryCount: rows.length });
      const comicInfo = rows.find(item => /(^|\/)comicinfo\.xml$/i.test(item.path));
      const [page, comicInfoXml] = await Promise.all([
        pages[0] ? this.extractPage(pages[0].file) : Promise.resolve(null),
        comicInfo ? this.extractXml(comicInfo.file) : Promise.resolve(null),
      ]);
      return { page, comicInfoXml };
    } finally { await archive.close(); }
  }

  private async extractPage(file: ArchiveFile): Promise<Blob | null> {
    const extracted = await file.extract();
    const header = new Uint8Array(await extracted.slice(0, 16).arrayBuffer());
    const mime = sniffComicPageMime(header);
    return mime ? new Blob([await extracted.arrayBuffer()], { type: mime }) : null;
  }

  private async extractXml(file: ArchiveFile): Promise<string | null> {
    try { return new TextDecoder("utf-8").decode(await (await file.extract()).arrayBuffer()); }
    catch { return null; }
  }

  private async download(fileId: string, knownSize: number | null): Promise<Buffer> {
    if (knownSize !== null && knownSize > MAX_ARCHIVE_BYTES) throw new Error("Arquivo de HQ excede o limite permitido para gerar capa.");
    const response = await this.drive.mediaRange(fileId);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("O Drive não retornou conteúdo para este arquivo.");
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > MAX_ARCHIVE_BYTES) throw new Error("Arquivo de HQ excede o limite permitido para gerar capa.");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }

  private async resize(page: Blob): Promise<Buffer | null> {
    try {
      const bytes = Buffer.from(await page.arrayBuffer());
      return await sharp(bytes).rotate()
        .resize({ width: THUMBNAIL_MAX_WIDTH, height: THUMBNAIL_MAX_HEIGHT, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();
    } catch (error) { this.log("COMIC_COVER_FAILED", { stage: "sharp-resize", ...this.describeError(error) }); return null; }
  }

  private log(event: string, details: Record<string, unknown>): void { console.info(JSON.stringify({ event, ...details })); }
  private describeError(error: unknown): { errorMessage: string; errorName?: string; httpStatus?: number } {
    const details = error as { message?: string; name?: string; status?: number };
    return { errorMessage: details?.message ?? String(error), errorName: details?.name, httpStatus: details?.status };
  }
}

/** Lightweight tag extraction, the same regex-based style already used for EPUB covers
 * rather than a new XML parser dependency - ComicInfo.xml is a flat, well-known schema.
 * A field that is not present stays null; nothing here is ever inferred or guessed. */
function parseComicInfo(xml: string): ComicCoverMetadata {
  return {
    title: xmlTag(xml, "Title"), series: xmlTag(xml, "Series"), number: xmlTag(xml, "Number"),
    year: xmlTag(xml, "Year"), summary: xmlTag(xml, "Summary"), writer: xmlTag(xml, "Writer"),
    publisher: xmlTag(xml, "Publisher"), genre: xmlTag(xml, "Genre"),
  };
}

function xmlTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  const text = match ? decodeXmlEntities(match[1]!.trim()) : "";
  return text || null;
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
