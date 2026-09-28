import type { ComicContourPoint, NormalizedBounds } from "./ComicInteractionTypes";

/** A point inside the outline the artist drew, in the page's own 0..1 space.
 *
 *  Ray casting: a point is inside when a line drawn from it to the edge of the page crosses
 *  the outline an odd number of times. It answers for any shape a balloon can have - two
 *  lobes, a cloud, a jagged shout - which a rectangle around it never could. */
export function comicPointInContour(contour: readonly ComicContourPoint[], point: { x: number; y: number }): boolean {
  if (contour.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = contour.length - 1; index < contour.length; previous = index++) {
    const a = contour[index]!, b = contour[previous]!;
    if ((a.y > point.y) === (b.y > point.y)) continue;
    if (point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** How far the point lies from the outline, in the page's 0..1 space; zero inside it. */
export function comicDistanceToContour(contour: readonly ComicContourPoint[], point: { x: number; y: number }): number {
  if (contour.length < 2) return Number.POSITIVE_INFINITY;
  if (comicPointInContour(contour, point)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0, previous = contour.length - 1; index < contour.length; previous = index++) {
    best = Math.min(best, toSegment(point, contour[previous]!, contour[index]!));
  }
  return best;
}

/** How far the point lies from a rectangle, in the same space; zero inside it. */
export function comicDistanceToBounds(bounds: NormalizedBounds, point: { x: number; y: number }): number {
  const dx = Math.max(bounds.x - point.x, 0, point.x - (bounds.x + bounds.width));
  const dy = Math.max(bounds.y - point.y, 0, point.y - (bounds.y + bounds.height));
  return Math.hypot(dx, dy);
}

function toSegment(point: { x: number; y: number }, a: ComicContourPoint, b: ComicContourPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}
