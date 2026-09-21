/** Where a page's text came from. The reader works the same either way; only the cost and
 *  the accuracy differ. */
export type ComicTextSourceName = "pdf-text-layer" | "ocr" | "none";

/** One recognized piece of text - a word or a line - in coordinates normalized to the page
 *  (0..1 on both axes), so the same block fits any screen, zoom level or render scale. */
export interface ComicTextFragment {
  text: string;
  x: number; y: number; width: number; height: number;
  confidence?: number;
}

/** Several fragments that share one visual region: a speech balloon, a caption box, a
 *  coloured panel. Shape is a coarse hint, never a colour-based balloon detector. */
export type ComicBlockShape = "balloon" | "caption";

export interface ComicTextBlock extends ComicTextFragment {
  id: string;
  pageNumber: number;
  lines: string[];
  background: string;
  ink: string;
  shape: ComicBlockShape;
}

export interface ComicPageBlocks {
  pageNumber: number;
  blocks: readonly ComicTextBlock[];
  source: ComicTextSourceName;
}
