import type { ComicRect } from "../ComicLayout";
import type { ComicTextRegion } from "./ComicInteractionTypes";
import { comicRegionBounds } from "./ComicRegionBounds";

export interface ComicBubbleLayoutInput {
  /** The container on screen - the balloon or box as it is drawn on the page. */
  source: ComicRect;
  viewport: { width: number; height: number };
  /** Phones and narrow windows may use almost the full width. */
  compact: boolean;
  region?: ComicTextRegion;
}

export interface ComicBubbleTarget extends ComicRect {
  /** How much bigger than the artwork the balloon ended up. */
  zoom: number;
}

export const COMIC_BUBBLE_ZOOM = {
  /** The height a capital letter should reach on screen, in CSS pixels. Everything else
   *  follows from this: the smaller the lettering is on the page, the more it grows. */
  capHeightPx: { compact: 15, wide: 17 },
  min: 1.15, max: 10,
  compact: { margin: 10, widthShare: .96, heightShare: .82 },
  wide: { margin: 20, widthShare: .62, heightShare: .78 },
} as const;

/** How tall a capital letter is inside this container, as a share of its height.
 *
 *  Two measurements agree on most containers: the one taken from the marks on the page and
 *  the one that follows from the recognized text and the box it sits in. Where they differ
 *  it is because something that is not lettering - the little drawing in the corner of a
 *  caption - stretched the first one, so the smaller of the two is the safer reading. */
export function comicCapShare(region: ComicTextRegion): number {
  const bounds = comicRegionBounds(region);
  if (bounds.visual.height <= 0) return .18;
  const lines = Math.max(1, region.text.trim().split(/\n+/).filter(Boolean).length);
  const fromText = bounds.text.height > 0 ? ((bounds.text.height / lines) * .72) / bounds.visual.height : 0;
  const measured = region.typography?.capHeight ? region.typography.capHeight / bounds.visual.height : 0;
  const readings = [fromText, measured].filter(value => value > .03 && value < .5);
  return readings.length > 0 ? Math.min(...readings) : .18;
}

/** How much to enlarge a container, from the size of its own lettering.
 *
 *  A fixed factor cannot serve both a caption the size of a stamp and a balloon that fills
 *  a panel: one stays unreadable and the other becomes a wall. What matters is the letters,
 *  so the measured cap height is taken to a comfortable reading size and the container
 *  comes along at whatever factor that needs - ten times for something tiny, barely one and
 *  a half for something already large. The screen then has the final word. */
export function comicBubbleZoom(source: ComicRect, viewport: { width: number; height: number }, compact: boolean, region?: ComicTextRegion): number {
  const capPx = Math.max(.5, (region ? comicCapShare(region) : .2) * source.height);
  const wanted = (compact ? COMIC_BUBBLE_ZOOM.capHeightPx.compact : COMIC_BUBBLE_ZOOM.capHeightPx.wide) / capPx;

  const limits = compact ? COMIC_BUBBLE_ZOOM.compact : COMIC_BUBBLE_ZOOM.wide;
  const margin = Math.min(limits.margin, viewport.width / 12);
  const maxWidth = Math.max(40, Math.min(viewport.width * limits.widthShare, viewport.width - margin * 2));
  const maxHeight = Math.max(40, Math.min(viewport.height * limits.heightShare, viewport.height - margin * 2));
  // The screen has the last word: a balloon that already fills the page simply stays put
  // rather than growing off the edge of it.
  const ceiling = Math.min(maxWidth / Math.max(1, source.width), maxHeight / Math.max(1, source.height));
  return Math.max(1, Math.min(Math.max(wanted, COMIC_BUBBLE_ZOOM.min), COMIC_BUBBLE_ZOOM.max, ceiling));
}

/** Where the enlarged balloon ends up: the same shape, simply bigger.
 *
 *  Both sides are scaled by one factor, so nothing is ever stretched, and the result is
 *  kept over its own artwork and inside the screen. */
export function comicBubbleTarget(input: ComicBubbleLayoutInput): ComicBubbleTarget {
  const limits = input.compact ? COMIC_BUBBLE_ZOOM.compact : COMIC_BUBBLE_ZOOM.wide;
  const { width: viewportWidth, height: viewportHeight } = input.viewport;
  const margin = Math.min(limits.margin, viewportWidth / 12);
  const zoom = comicBubbleZoom(input.source, input.viewport, input.compact, input.region);
  const width = input.source.width * zoom, height = input.source.height * zoom;

  // It grows out of its own place on the page, then steps inside the screen if it has to.
  const centreX = input.source.x + input.source.width / 2, centreY = input.source.y + input.source.height / 2;
  const x = Math.min(Math.max(margin, centreX - width / 2), Math.max(margin, viewportWidth - margin - width));
  const y = Math.min(Math.max(margin, centreY - height / 2), Math.max(margin, viewportHeight - margin - height));
  return { x, y, width, height, zoom };
}

/** The recognized text, reflowed for a wider balloon: single line breaks inside a sentence
 *  become spaces (a hyphenated break joins), blank lines between paragraphs stay. Nothing
 *  is corrected, completed or rewritten. */
export function comicBubbleText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim()
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.replace(/-\n\s*/g, "-").replace(/\s*\n\s*/g, " "))
    .join("\n\n");
}
