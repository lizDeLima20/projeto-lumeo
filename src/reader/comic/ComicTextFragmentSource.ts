import type { PDFPageProxy } from "pdfjs-dist";
import type { ComicTextFragment, ComicTextSourceName } from "./ComicTextTypes";

export interface ComicPageSample {
  pageNumber: number;
  page: PDFPageProxy | null;
  canvas: HTMLCanvasElement | null;
}

/** A way of finding text on a comic page. Everything downstream - grouping, colours, the
 *  hotspots - works off the fragments, so a source can be swapped without touching the
 *  reader. */
export interface ComicTextFragmentSource {
  readonly name: ComicTextSourceName;
  available(): Promise<boolean>;
  fragments(sample: ComicPageSample, signal?: AbortSignal): Promise<ComicTextFragment[]>;
  dispose?(): Promise<void>;
}
