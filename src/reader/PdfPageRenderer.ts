import type { PDFPageProxy, RenderTask } from "pdfjs-dist";
import type { ReaderSettings } from "./ReaderSettingsManager";

export interface ReaderStageSize { width: number; height: number; }

export class PdfPageRenderer {
  private activeTask: RenderTask | null = null;
  private readonly maxCanvasPixels = 16_000_000;

  public constructor(private readonly canvas: HTMLCanvasElement) {}

  public async render(page: PDFPageProxy, settings: Readonly<ReaderSettings>, stage: ReaderStageSize): Promise<boolean> {
    this.cancel();
    const base = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(240, stage.width - 24);
    const availableHeight = Math.max(240, stage.height - 24);
    let scale = settings.zoom / 100;
    if (settings.fitMode === "width") scale = availableWidth / base.width;
    if (settings.fitMode === "page") scale = Math.min(availableWidth / base.width, availableHeight / base.height);
    const viewport = page.getViewport({ scale });
    const requestedRatio = Math.min(window.devicePixelRatio || 1, 2.5);
    const safeRatio = Math.min(requestedRatio, Math.sqrt(this.maxCanvasPixels / Math.max(1, viewport.width * viewport.height)));
    const outputScale = Math.max(1, safeRatio);
    this.canvas.width = Math.floor(viewport.width * outputScale);
    this.canvas.height = Math.floor(viewport.height * outputScale);
    this.canvas.style.width = `${Math.floor(viewport.width)}px`;
    this.canvas.style.height = `${Math.floor(viewport.height)}px`;
    const context = this.canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Seu navegador não conseguiu preparar a página do PDF.");
    const task = page.render({ canvas: this.canvas, canvasContext: context, viewport,
      transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0], background: "rgba(0,0,0,0)" });
    this.activeTask = task;
    try { await task.promise; return true; }
    catch (error) {
      if (error instanceof Error && error.name === "RenderingCancelledException") return false;
      throw error;
    }
    finally { if (this.activeTask === task) this.activeTask = null; page.cleanup(); }
  }
  public cancel(): void { this.activeTask?.cancel(); this.activeTask = null; }
}
