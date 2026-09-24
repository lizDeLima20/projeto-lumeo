import { getDocument, GlobalWorkerOptions, type PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ComicConverter, type ComicConversionResult, type ComicConverterOptions } from "./ComicConverter";
import { IndexedDbComicConversionCache } from "./ComicConversionCache";
import { ComicRegionOcr } from "./ComicRegionOcr";
import { comicReadPageRegions } from "./ComicPageRegionReader";
import { comicSourceKey } from "./ComicConversionIdentity";

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
          page = await pdf.getPage(index + 1);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: 3072 / Math.max(base.width, base.height) });
          canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
          if (!context) throw new Error("Canvas indisponivel para conversao de HQ.");
          const rendering = page.render({ canvas, canvasContext: context, viewport });
          const abortRender = (): void => rendering.cancel();
          signal?.addEventListener("abort", abortRender, { once: true });
          try { signal?.throwIfAborted(); await rendering.promise; } finally { signal?.removeEventListener("abort", abortRender); }
          signal?.throwIfAborted();
          const blob = await new Promise<Blob>((resolve, reject) => canvas!.toBlob(value => value ? resolve(value) : reject(new Error("Falha ao codificar pagina.")), "image/webp", 0.95));
          const mimeType = blob.type === "image/webp" ? "image/webp" : "image/png";
          return { path: `pages/${String(index + 1).padStart(3, "0")}.${mimeType === "image/webp" ? "webp" : "png"}`,
            data: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height, mimeType, cover: coverPages.includes(index) };
        },
        regionProvider: async (index, asset, signal) => {
          if (!canvas) throw new Error("Pagina nao renderizada.");
          // Manga is read right to left; everything else left to right.
          asset.interactionAssets = [];
          return await comicReadPageRegions(canvas, index, ocr, signal, input.contentType === "manga" ? "rtl" : "ltr", asset.interactionAssets);
        }, releasePage: release,
      }, { ...options, cache });
    } catch (error) {
      if (!delegated) options.onProgress?.({ stage: "FAILED", currentPage: 0, totalPages: 0, progress: 0, message: String(error) });
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", cancel);
      release(); await ocr.dispose(); await loading?.destroy();
    }
  }
}
