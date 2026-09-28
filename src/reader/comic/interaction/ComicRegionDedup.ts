import type { ComicTextRegion, NormalizedBounds } from "./ComicInteractionTypes";
import { comicRegionBounds } from "./ComicRegionBounds";

export function comicBoundsIou(a: NormalizedBounds, b: NormalizedBounds): number {
  const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return overlap / Math.max(Number.EPSILON, a.width * a.height + b.width * b.height - overlap);
}

/** A small balloon contained by another balloon's BOX is not the same artwork.
 * Suppression requires comparable sizes and near-identical visual bounds. */
export function comicRegionsDuplicate(a: ComicTextRegion, b: ComicTextRegion): boolean {
  const first = comicRegionBounds(a).visual, second = comicRegionBounds(b).visual;
  const firstArea = first.width * first.height, secondArea = second.width * second.height;
  if (Math.min(firstArea, secondArea) / Math.max(Number.EPSILON, firstArea, secondArea) < .65) return false;
  return comicBoundsIou(first, second) >= .75;
}
