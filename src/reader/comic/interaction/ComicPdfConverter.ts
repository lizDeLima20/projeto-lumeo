import { getDocument, GlobalWorkerOptions, type PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ComicConverter, type ComicConversionResult, type ComicConverterOptions } from "./ComicConverter";
import { IndexedDbComicConversionCache } from "./ComicConversionCache";
import { ComicRegionOcr } from "./ComicRegionOcr";
import { comicReadPageRegions } from "./ComicPageRegionReader";
import { comicSourceKey } from "./ComicConversionIdentity";
import { ComicStageTimer } from "./ComicStageTimer";
import type { ComicConversionCache } from "./ComicConversionCache";

export interface ComicPdfInput { contentType: "comic" | "manga"; blob: Blob; title: string; fileName?: string; coverPages?: readonly number[]; }

/** Explicit comic-only entry point; never registered in the normal book converter. */
export class ComicPdfConverter {
  public async convert(input: ComicPdfInput, options: ComicConverterOptions = {}): Promise<ComicConversionResult> {
    if (input.contentType !== "comic" && input.contentType !== "manga") throw new Error("Conversor exclusivo de HQ/manga.");
    options.onProgress?.({ stage: "PREPARING", currentPage: 0, totalPages: 0, progress: 0 });
    const cache = options.cache ?? new IndexedDbComicConversionCache();
    const coverPages = input.coverPages ?? [0];
    let page: PDFPageProxy | undefined;
    let canvas: HTMLCanvasElement | undefined;
    const ocr = new ComicRegionOcr();
    let loading: ReturnType<typeof getDocument> | undefined;
    const release = (): void => { if (canvas) canvas.width = canvas.height = 0; canvas = undefined; page?.cleanup(); page = undefined; };
    const cancel = (): void => { void loading?.destroy(); };
    let delegated = false;
    // One timer per page, opened when the page is rendered and closed when it is stored:
    // every stage in between reports into it, so the line printed at the end of a page
    // says where that page's time went on the device that spent it.
    let timer: ComicStageTimer | undefined;
    let measured: { sourceWidth: number; sourceHeight: number; renderWidth: number; renderHeight: number; regionCount: number } | undefined;
    try {
      options.signal?.throwIfAborted();
      const key = await comicSourceKey(input.blob, coverPages);
      options.signal?.throwIfAborted();
      const existing = await cache.completed(key);
      options.signal?.throwIfAborted();
      if (existing) {
        // The converter validates the cached document and emits the terminal event.
        delegated = true;
        return await new ComicConverter().convert({ id: key, title: input.title, totalPages: existing.document.pages.length, conversionKey: key,
          pageProvider: async () => { throw new Error("Unexpected cache miss"); } }, { ...options, cache });
      }
      GlobalWorkerOptions.workerSrc = workerUrl;
      loading = getDocument({ data: await input.blob.arrayBuffer() });
      options.signal?.addEventListener("abort", cancel, { once: true });
      options.signal?.throwIfAborted();
      const pdf = await loading.promise;
      delegated = true;
      return await new ComicConverter().convert({
        id: key, title: input.title, sourceFormat: "pdf", sourceFileName: input.fileName, language: "por", totalPages: pdf.numPages, conversionKey: key,
        pageProvider: async (index, signal) => {
          signal?.throwIfAborted();
          timer = new ComicStageTimer();
          page = await pdf.getPage(index + 1);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: 3072 / Math.max(base.width, base.height) });
          canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          measured = { sourceWidth: Math.round(base.width), sourceHeight: Math.round(base.height),
            renderWidth: canvas.width, renderHeight: canvas.height, regionCount: 0 };
          const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
          if (!context) throw new Error("Canvas indisponivel para conversao de HQ.");
          await timer.step("PDF_RENDER", async () => {
            const rendering = page!.render({ canvas: canvas!, canvasContext: context, viewport });
            const abortRender = (): void => rendering.cancel();
            signal?.addEventListener("abort", abortRender, { once: true });
            try { signal?.throwIfAborted(); await rendering.promise; } finally { signal?.removeEventListener("abort", abortRender); }
          });
          signal?.throwIfAborted();
          const blob = await timer.step("ASSET_ENCODING", () => new Promise<Blob>((resolve, reject) => canvas!.toBlob(value => value ? resolve(value) : reject(new Error("Falha ao codificar pagina.")), "image/webp", 0.95)));
          const mimeType = blob.type === "image/webp" ? "image/webp" : "image/png";
          return { path: `pages/${String(index + 1).padStart(3, "0")}.${mimeType === "image/webp" ? "webp" : "png"}`,
            data: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height, mimeType, cover: coverPages.includes(index) };
        },
        regionProvider: async (index, asset, signal) => {
          if (!canvas) throw new Error("Pagina nao renderizada.");
          // Manga is read right to left; everything else left to right.
          asset.interactionAssets = [];
          const regions = await comicReadPageRegions(canvas, index, ocr, signal,
            input.contentType === "manga" ? "rtl" : "ltr", asset.interactionAssets, timer, asset);
          if (measured) measured.regionCount = regions.length;
          return regions;
        }, releasePage: release, priority: options.priority, onPageStarted: options.onPageStarted,
      }, { ...options, cache: timed(cache, () => timer, () => measured, () => { timer = undefined; measured = undefined; }) });
    } catch (error) {
      if (!delegated) options.onProgress?.({ stage: "FAILED", currentPage: 0, totalPages: 0, progress: 0, message: String(error) });
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", cancel);
      release(); await ocr.dispose(); await loading?.destroy();
    }
  }
}

/** The cache, with the last stage of a page timed on the way through: storing it. The page
 *  is reported here because this is where it ends. */
function timed(cache: ComicConversionCache, timer: () => ComicStageTimer | undefined,
  measured: () => { sourceWidth: number; sourceHeight: number; renderWidth: number; renderHeight: number; regionCount: number } | undefined,
  done: () => void): ComicConversionCache {
  return {
    page: (key, index) => cache.page(key, index),
    completed: key => cache.completed(key),
    complete: (key, result) => cache.complete(key, result),
    savePage: async (key, value) => {
      const stopwatch = timer(), details = measured();
      if (!stopwatch) return await cache.savePage(key, value);
      await stopwatch.step("INDEXEDDB_WRITE", () => cache.savePage(key, value));
      if (details) stopwatch.report({ pageIndex: value.page.index, ...details });
      done();
    },
  };
}
