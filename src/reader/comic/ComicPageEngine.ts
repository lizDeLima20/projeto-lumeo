import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { RenderedPageCache } from "../image/RenderedPageCache";

GlobalWorkerOptions.workerSrc = workerUrl;

export interface ComicStageSize { width: number; height: number; }

/** PDF loading and page rendering for comics. It reuses the reader's rendered-page cache
 *  but presents a page as one whole picture: the scale always fits the page inside the
 *  stage, so art is never cropped, stretched or cut into columns. */
export class ComicPageEngine {
  private task: PDFDocumentLoadingTask | null = null;
  private document: PDFDocumentProxy | null = null;
  private active: RenderTask | null = null;
  /** An open book turning either way can show six pages; two more of slack. */
  private readonly cache = new RenderedPageCache(8);
  private readonly maxCanvasPixels = 18_000_000;
  private readonly bitmapStage = new Map<number, string>();
  private generation = 0;

  public async open(blob: Blob): Promise<number> {
    await this.close();
    this.task = getDocument({ data: await blob.arrayBuffer() });
    this.document = await this.task.promise;
    return this.document.numPages;
  }

  public get totalPages(): number { return this.document?.numPages ?? 0; }

  public async page(pageNumber: number): Promise<PDFPageProxy | null> {
    if (!this.document || pageNumber < 1 || pageNumber > this.document.numPages) return null;
    return this.document.getPage(pageNumber);
  }

  /** Page width / height, read from the PDF without drawing anything. */
  public async aspect(pageNumber: number): Promise<number | null> {
    const page = await this.page(pageNumber); if (!page) return null;
    const viewport = page.getViewport({ scale: 1 });
    return viewport.height ? viewport.width / viewport.height : null;
  }

  public async render(pageNumber: number, stage: ComicStageSize): Promise<HTMLCanvasElement | null> {
    const size = ComicPageEngine.stageKey(stage);
    const cached = this.cache.get(pageNumber);
    if (cached && this.bitmapStage.get(pageNumber) === size) return cached.canvas;
    const generation = this.generation;
    const page = await this.page(pageNumber); if (!page) return null;
    const base = page.getViewport({ scale: 1 });
    // contain, per page: the smaller of the two ratios, so this page - whatever its own
    // proportions - is whole inside the stage it is shown on.
    const scale = Math.max(0.05, Math.min(stage.width / base.width, stage.height / base.height));
    const viewport = page.getViewport({ scale });
    /* The bitmap follows the screen's real pixel density, so a page drawn larger stays
       sharp on a 3x phone; the pixel budget below still caps memory on big pages. */
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 3);
    const safeRatio = Math.max(1, Math.min(ratio, Math.sqrt(this.maxCanvasPixels / Math.max(1, viewport.width * viewport.height))));
    const canvas = document.createElement("canvas");
    canvas.className = "comic-page__canvas";
    canvas.width = Math.floor(viewport.width * safeRatio); canvas.height = Math.floor(viewport.height * safeRatio);
    canvas.style.width = `${Math.floor(viewport.width)}px`; canvas.style.height = `${Math.floor(viewport.height)}px`;
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) return null;
    const task = page.render({ canvas, canvasContext: context, viewport, transform: safeRatio === 1 ? undefined : [safeRatio, 0, 0, safeRatio, 0, 0] });
    this.active = task;
    try {
      await task.promise;
      // A resize while this page was drawing means it is already the wrong size: hand it
      // back to whoever asked, but never let it into the cache as the current bitmap.
      if (generation === this.generation) { this.cache.set({ pageNumber, canvas, createdAt: Date.now() }); this.bitmapStage.set(pageNumber, size); }
      return canvas;
    }
    catch (error) { if (error instanceof Error && error.name === "RenderingCancelledException") return null; throw error; }
    finally { if (this.active === task) this.active = null; }
  }

  /** A resize or a rotation changes the fitted scale, so every cached bitmap is the wrong
   *  size now - including any still being drawn for the old size. */
  public invalidate(): void { this.generation++; this.cache.clear(); this.bitmapStage.clear(); }

  public static stageKey(stage: ComicStageSize): string { return `${Math.round(stage.width)}x${Math.round(stage.height)}`; }
  public cancel(): void { this.active?.cancel(); this.active = null; }
  public async close(): Promise<void> {
    this.cancel(); this.cache.clear(); this.bitmapStage.clear();
    await this.task?.destroy().catch(() => undefined);
    this.task = null; this.document = null;
  }
}
