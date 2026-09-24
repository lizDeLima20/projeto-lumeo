import type { ComicTextRegion, NormalizedBounds } from "./ComicInteractionTypes";

export interface ComicRegionRectangles {
  /** Where the letters are. */
  text: NormalizedBounds;
  /** The balloon, box or caption that holds them - what the enlarged balloon is made of. */
  visual: NormalizedBounds;
  /** What a finger may touch: the whole container, never only the words. */
  hit: NormalizedBounds;
}

const clamp = (bounds: NormalizedBounds): NormalizedBounds => {
  const x = Math.min(Math.max(0, bounds.x), 1), y = Math.min(Math.max(0, bounds.y), 1);
  return { x, y, width: Math.max(1e-6, Math.min(bounds.width, 1 - x)), height: Math.max(1e-6, Math.min(bounds.height, 1 - y)) };
};

/** The three rectangles of a region, whatever the .lima version wrote.
 *
 *  A version 1 package only ever stored one rectangle around the recognized words, so the
 *  container is unknown and all three collapse onto it - the reader keeps working, it just
 *  does not gain a bigger touch target it was never told about. */
export function comicRegionBounds(region: ComicTextRegion): ComicRegionRectangles {
  const stored: NormalizedBounds = { x: region.x, y: region.y, width: region.width, height: region.height };
  const visual = clamp(region.visualBounds ?? stored);
  return { text: clamp(region.textBounds ?? visual), visual, hit: clamp(region.hitBounds ?? stored) };
}

/** Grows a rectangle by a share of its own size, without leaving the page. */
export function comicPadBounds(bounds: NormalizedBounds, share: number, minimum = 0): NormalizedBounds {
  const padX = Math.max(bounds.width * share, minimum), padY = Math.max(bounds.height * share, minimum);
  const x = Math.max(0, bounds.x - padX), y = Math.max(0, bounds.y - padY);
  return clamp({ x, y, width: Math.min(1 - x, bounds.width + padX * 2), height: Math.min(1 - y, bounds.height + padY * 2) });
}
