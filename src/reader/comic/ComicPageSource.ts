import type { PDFPageProxy } from "pdfjs-dist";
import type { ComicStageSize } from "./ComicPageEngine";

/** A comic supplies bitmaps to the existing turn controller, independent of its file format. */
export interface ComicPageSource {
  open(blob: Blob): Promise<number>;
  aspect(pageNumber: number): Promise<number | null>;
  render(pageNumber: number, stage: ComicStageSize): Promise<HTMLCanvasElement | null>;
  page(pageNumber: number): Promise<PDFPageProxy | null>;
  invalidate(): void;
  close(): Promise<void>;
}
