import { IndexedDbComicConversionCache, type ComicConversionCache } from "./ComicConversionCache";
import { ComicInteractionValidator } from "./ComicInteractionValidator";
import { comicSourceKey } from "./ComicConversionIdentity";
import type { ComicConversionResult, ComicConverterOptions } from "./ComicConverter";
import type { ComicPdfInput } from "./ComicPdfConverter";
import type { ComicConversionProgress, ComicPage, ComicPageAsset } from "./ComicInteractionTypes";

/** What this service needs of a converter. The converter itself is handed in rather than
 *  reached for: it carries the PDF engine with it, which only exists in a browser. */
export interface ComicPackageConverter {
  convert(input: ComicPdfInput, options: ComicConverterOptions): Promise<ComicConversionResult>;
}

export interface ComicConversionRequest {
  bookId: string;
  blob: Blob;
  title: string;
  fileName?: string;
  contentType: ComicPdfInput["contentType"];
  coverPages?: readonly number[];
}

export interface ComicConversionOptions {
  onProgress?: (progress: ComicConversionProgress) => void;
  /** The pages the reader wants first. Asked again before every page. */
  priority?: () => readonly number[];
  /** A page finished and was stored: its regions can answer to a touch right away. */
  onPageReady?: (page: ComicPage, asset: ComicPageAsset) => void | Promise<void>;
  onPageStarted?: (pageIndex: number) => void;
  signal?: AbortSignal;
}

export interface ComicConversionOutcome {
  result: ComicConversionResult;
  key: string;
  /** Whether the package came from storage rather than being made now. */
  cached: boolean;
}

export type ComicConversionEvent =
  | "COMIC_OPEN_REQUEST" | "COMIC_CONVERSION_LOOKUP" | "COMIC_CONVERSION_STARTED"
  | "COMIC_CURRENT_PAGE_CONVERSION_STARTED" | "COMIC_PAGE_READY"
  | "COMIC_CONVERSION_COMPLETED" | "COMIC_RENDERER_SELECTED";

/** Anything that identifies a reader, a file or a person stays out of this. */
export function comicLog(event: ComicConversionEvent, details: Record<string, unknown>): void {
  console.info(JSON.stringify({ event, ...details }));
}

const regionCount = (result: ComicConversionResult): number =>
  result.document.pages.reduce((total, page) => total + page.regions.length, 0);

/** Opening a comic and having a comic to open.
 *
 *  A .lima package is what makes the balloons of a comic touchable, and it is made by
 *  converting the file once. The reader used to only look for one and read the comic flat
 *  when it found nothing, which is why the workbench and the library disagreed: the
 *  workbench converted, the library never did. Here the two meet - the same converter, the
 *  same key, the same package - so the first opening of a comic prepares it and every
 *  opening after that finds it ready.
 *
 *  Two readers arriving at the same comic at once share one conversion rather than starting
 *  two: the promise is held against the key while it runs. Nothing is remembered from a
 *  conversion that did not finish; the converter only stores a package once the whole
 *  document is written and checked, and its half-finished pages are resumed, not served. */
export class ComicConversionService {
  private static readonly running = new Map<string, Promise<ComicConversionResult>>();

  public constructor(
    private readonly converter: ComicPackageConverter,
    private readonly cache: ComicConversionCache = new IndexedDbComicConversionCache(),
  ) {}

  /** The package for this comic: from storage when it is there, made now when it is not. */
  public async open(request: ComicConversionRequest, options: ComicConversionOptions = {}): Promise<ComicConversionOutcome> {
    const coverPages = request.coverPages ?? [0];
    const key = await comicSourceKey(request.blob, coverPages);
    comicLog("COMIC_OPEN_REQUEST", { bookId: request.bookId, conversionKey: key });
    options.signal?.throwIfAborted();

    const stored = await this.lookup(key);
    if (stored) {
      comicLog("COMIC_CONVERSION_LOOKUP", { bookId: request.bookId, conversionKey: key, cache: "hit",
        manifestVersion: stored.document.manifest.version, pageCount: stored.document.pages.length, regionCount: regionCount(stored) });
      return { result: stored, key, cached: true };
    }
    comicLog("COMIC_CONVERSION_LOOKUP", { bookId: request.bookId, conversionKey: key, cache: "miss" });

    const result = await this.convert(key, request, options);
    return { result, key, cached: false };
  }

  /** Exactly this key, or nothing: a package made by another pipeline, another cover
   *  setting or another file is not this comic's package, and a stored one that no longer
   *  validates is treated as absent rather than shown. */
  private async lookup(key: string): Promise<ComicConversionResult | undefined> {
    const stored = await this.cache.completed(key).catch(() => undefined);
    if (!stored) return undefined;
    try {
      new ComicInteractionValidator().validateDocument(stored.document);
      return stored;
    } catch { return undefined; }
  }

  private async convert(key: string, request: ComicConversionRequest, options: ComicConversionOptions): Promise<ComicConversionResult> {
    const running = ComicConversionService.running.get(key);
    if (running) return await running;

    comicLog("COMIC_CONVERSION_STARTED", { bookId: request.bookId, conversionKey: key });
    const work = this.converter.convert({
      contentType: request.contentType, blob: request.blob, title: request.title,
      fileName: request.fileName, coverPages: request.coverPages ?? [0],
    }, { cache: this.cache, signal: options.signal, onProgress: options.onProgress,
      priority: options.priority, onPageStarted: options.onPageStarted, onPageProcessed: options.onPageReady })
      .then(result => {
        comicLog("COMIC_CONVERSION_COMPLETED", { bookId: request.bookId, conversionKey: key,
          manifestVersion: result.document.manifest.version, pageCount: result.document.pages.length, regionCount: regionCount(result) });
        return result;
      })
      .finally(() => { ComicConversionService.running.delete(key); });
    ComicConversionService.running.set(key, work);
    return await work;
  }
}
