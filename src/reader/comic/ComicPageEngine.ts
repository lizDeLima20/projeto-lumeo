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
  private readonly cache = new RenderedPageCache(5);
  private readonly maxCanvasPixels = 18_000_000;

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

  public async render(pageNumber: number, stage: ComicStageSize): Promise<HTMLCanvasElement | null> {
    const cached = this.cache.get(pageNumber); if (cached) return cached.canvas;
    const page = await this.page(pageNumber); if (!page) return null;
    const base = page.getViewport({ scale: 1 });
    // contain: the smaller of the two ratios, so the whole page is inside the stage.
    const scale = Math.max(0.05, Math.min(stage.width / base.width, stage.height / base.height));
    const viewport = page.getViewport({ scale });
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    const safeRatio = Math.max(1, Math.min(ratio, Math.sqrt(this.maxCanvasPixels / Math.max(1, viewport.width * viewport.height))));
    const canvas = document.createElement("canvas");
    canvas.className = "comic-page__canvas";
    canvas.width = Math.floor(viewport.width * safeRatio); canvas.height = Math.floor(viewport.height * safeRatio);
    canvas.style.width = `${Math.floor(viewport.width)}px`; canvas.style.height = `${Math.floor(viewport.height)}px`;
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) return null;
    const task = page.render({ canvas, canvasContext: context, viewport, transform: safeRatio === 1 ? undefined : [safeRatio, 0, 0, safeRatio, 0, 0] });
    this.active = task;
    try { await task.promise; this.cache.set({ pageNumber, canvas, createdAt: Date.now() }); return canvas; }
    catch (error) { if (error instanceof Error && error.name === "RenderingCancelledException") return null; throw error; }
    finally { if (this.active === task) this.active = null; }
  }

  /** A resize changes the fitted scale, so every cached bitmap is the wrong size now. */
  public invalidate(): void { this.cache.clear(); }
  public cancel(): void { this.active?.cancel(); this.active = null; }
  public async close(): Promise<void> {
    this.cancel(); this.cache.clear();
    await this.task?.destroy().catch(() => undefined);
    this.task = null; this.document = null;
  }
}
