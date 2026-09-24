import { COMIC_LIMA_VERSION, type ComicConversionProgress, type ComicDocument, type ComicMetadata, type ComicPageAsset, type ComicTextRegion } from "./ComicInteractionTypes";
import type { ComicConversionCache } from "./ComicConversionCache";
import { ComicInteractionValidator } from "./ComicInteractionValidator";
import { ComicLimaWriter } from "./ComicLimaWriter";

export interface ComicConversionInput {
  id: string;
  title: string;
  author?: string;
  language?: string;
  sourceFileName?: string;
  sourceFormat?: ComicMetadata["sourceFormat"];
  totalPages: number;
  pageProvider: (pageIndex: number, signal?: AbortSignal) => Promise<ComicPageAsset>;
  regionProvider?: (pageIndex: number, asset: ComicPageAsset, signal?: AbortSignal) => Promise<ComicTextRegion[]>;
  releasePage?: () => void;
  conversionKey?: string;
  /** The pages the reader wants first, most wanted first - normally the page on screen
   *  and the two after it. Asked again before every page, so turning to another part of
   *  the comic changes what is converted next. */
  priority?: () => readonly number[];
  /** Which page the queue just picked up. */
  onPageStarted?: (pageIndex: number) => void;
}

export interface ComicConversionResult {
  document: ComicDocument;
  bytes: Uint8Array;
}

export interface ComicConverterOptions {
  onProgress?: (progress: ComicConversionProgress) => void;
  /** The pages the reader wants first, asked again before every page. */
  priority?: () => readonly number[];
  onPageStarted?: (pageIndex: number) => void;
  onPageProcessed?: (page: ComicDocument["pages"][number], asset: ComicPageAsset) => Promise<void> | void;
  signal?: AbortSignal;
  cache?: ComicConversionCache;
}

export class ComicConverter {
  public async convert(input: ComicConversionInput, options: ComicConverterOptions = {}): Promise<ComicConversionResult> {
    const writer = new ComicLimaWriter();
    const validator = new ComicInteractionValidator();
    const pages: ComicDocument["pages"] = [];
    const createdAt = new Date().toISOString();
    this.progress(options, "PREPARING", 0, input.totalPages);
    try {
      options.signal?.throwIfAborted();
      if (!Number.isInteger(input.totalPages) || input.totalPages < 1) throw new Error("HQ sem paginas validas.");
      const cached = input.conversionKey ? await options.cache?.completed(input.conversionKey) : undefined;
      options.signal?.throwIfAborted();
      if (cached) {
        validator.validateDocument(cached.document);
        this.progress(options, "COMPLETED", input.totalPages, input.totalPages);
        return cached;
      }
      // Pages are converted in the order the reader needs them, not in the order they are
      // bound. What comes out is the same either way: the document is sorted by index
      // before the manifest is written, so a comic prepared from page eighty-seven is
      // structurally the same package as one prepared from page one.
      const remaining = new Set(Array.from({ length: input.totalPages }, (_, index) => index));
      while (remaining.size > 0) {
        const pageIndex = ComicConverter.nextPage(remaining, input.priority?.());
        remaining.delete(pageIndex);
        options.signal?.throwIfAborted();
        this.progress(options, "PROCESSING_PAGE", pages.length, input.totalPages);
        input.onPageStarted?.(pageIndex);
        const saved = input.conversionKey ? await options.cache?.page(input.conversionKey, pageIndex) : undefined;
        try {
          const asset = saved?.asset ?? await input.pageProvider(pageIndex, options.signal);
          options.signal?.throwIfAborted();
          const page: ComicDocument["pages"][number] = saved?.page ?? {
            index: pageIndex,
            id: `page-${String(pageIndex + 1).padStart(3, "0")}`,
            imagePath: asset.path,
            width: asset.width,
            height: asset.height,
            mimeType: asset.mimeType,
            cover: asset.cover ?? pageIndex === 0,
            regions: [],
          };
          if (!saved && !page.cover && input.regionProvider) page.regions = await input.regionProvider(pageIndex, asset, options.signal);
          options.signal?.throwIfAborted();
          validator.validatePage(page);
          if (page.index !== pageIndex || page.imagePath !== asset.path || !asset.data.length) throw new Error("Pagina de HQ inconsistente.");
          if (!saved && input.conversionKey) await options.cache?.savePage(input.conversionKey, { page, asset });
          options.signal?.throwIfAborted();
          writer.page(page, asset);
          pages.push(page);
          await options.onPageProcessed?.(page, asset);
        } finally { input.releasePage?.(); }
        // Yield between pages even when every stage was served from cache.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      // The package is written in the order the pages were converted; the document that
      // describes it is always in reading order.
      pages.sort((a, b) => a.index - b.index);
      options.signal?.throwIfAborted();
      this.progress(options, "SAVING", input.totalPages, input.totalPages);
      const document: ComicDocument = {
        manifest: {
          format: "lima",
          version: COMIC_LIMA_VERSION,
          contentType: "comic",
          documentId: input.id,
          createdAt,
          generator: "lumeo-comic-converter",
          metadataPath: "metadata/metadata.json",
          pagesPath: "pages/",
          interactionPath: "interaction/",
          pages: pages.map(page => ({
            index: page.index,
            id: page.id,
            imagePath: page.imagePath,
            interactionPath: `interaction/${String(page.index + 1).padStart(3, "0")}.json`,
            width: page.width,
            height: page.height,
            mimeType: page.mimeType,
            cover: page.cover,
          })),
        },
        metadata: {
          id: input.id,
          title: input.title,
          author: input.author,
          language: input.language,
          sourceFileName: input.sourceFileName,
          sourceFormat: input.sourceFormat ?? "unknown",
          createdAt,
          conversionKey: input.conversionKey,
        },
        pages,
      };
      validator.validateDocument(document);
      const bytes = writer.finish(document);
      options.signal?.throwIfAborted();
      if (input.conversionKey) await options.cache?.complete(input.conversionKey, { document, bytes });
      options.signal?.throwIfAborted();
      this.progress(options, "COMPLETED", input.totalPages, input.totalPages);
      return { document, bytes };
    } catch (error) {
      this.progress(options, "FAILED", pages.length, input.totalPages, error instanceof Error ? error.message : "Falha ao converter HQ.");
      throw error;
    }
  }

  /** The next page to convert: the first one the reader asked for that is still missing,
   *  or else the earliest page still missing. */
  private static nextPage(remaining: ReadonlySet<number>, wanted?: readonly number[]): number {
    for (const index of wanted ?? []) if (remaining.has(index)) return index;
    let earliest = Number.MAX_SAFE_INTEGER;
    for (const index of remaining) if (index < earliest) earliest = index;
    return earliest;
  }

  private progress(options: ComicConverterOptions, stage: ComicConversionProgress["stage"], currentPage: number, totalPages: number, message?: string): void {
    options.onProgress?.({ stage, currentPage, totalPages, progress: totalPages > 0 ? currentPage / totalPages : 0, message });
  }
}
