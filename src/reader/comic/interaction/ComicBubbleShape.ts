import type { ComicContourPoint, ComicRegionShape, NormalizedBounds } from "./ComicInteractionTypes";

/** The outline of a container as an SVG path, in a 0..100 box.
 *
 *  The points come from the page itself, normalized to it, so here they are only moved
 *  into the container's own box. A balloon is drawn through its points with curves, since
 *  its outline was sampled from a grid and would otherwise show the stairs; a caption box
 *  is drawn with straight lines, because its corners are corners. */
export function comicBubblePath(contour: readonly ComicContourPoint[], visual: NormalizedBounds, shape: ComicRegionShape): string {
  const points = contour.map(point => ({
    x: ((point.x - visual.x) / Math.max(1e-6, visual.width)) * 100,
    y: ((point.y - visual.y) / Math.max(1e-6, visual.height)) * 100,
  }));
  if (points.length < 3) return "";
  if (shape === "rectangle" || points.length < 6) {
    return `M ${points.map(point => `${round(point.x)} ${round(point.y)}`).join(" L ")} Z`;
  }
  return smoothPath(points);
}

/** A closed curve through every point (Catmull-Rom, written as cubic Béziers). */
function smoothPath(points: readonly { x: number; y: number }[]): string {
  const at = (index: number): { x: number; y: number } => points[(index + points.length) % points.length]!;
  let path = `M ${round(at(0).x)} ${round(at(0).y)}`;
  for (let index = 0; index < points.length; index++) {
    const previous = at(index - 1), current = at(index), next = at(index + 1), after = at(index + 2);
    const firstX = current.x + (next.x - previous.x) / 6, firstY = current.y + (next.y - previous.y) / 6;
    const secondX = next.x - (after.x - current.x) / 6, secondY = next.y - (after.y - current.y) / 6;
    path += ` C ${round(firstX)} ${round(firstY)}, ${round(secondX)} ${round(secondY)}, ${round(next.x)} ${round(next.y)}`;
  }
  return `${path} Z`;
}

/** When a package has no outline - an older .lima, or a shape too uncertain to trust - a
 *  plain container of the right family, which is honest rather than invented. */
export function comicBubbleFallbackPath(shape: ComicRegionShape): string {
  switch (shape) {
    case "rectangle": return "M 1 1 L 99 1 L 99 99 L 1 99 Z";
    case "cloud": case "balloon": return "M 50 1 C 78 1, 99 12, 99 32 C 99 55, 99 72, 99 78 C 99 92, 76 99, 50 99 C 24 99, 1 92, 1 78 C 1 72, 1 55, 1 32 C 1 12, 22 1, 50 1 Z";
    default: return "M 3 6 L 97 3 L 99 94 L 5 97 Z";
  }
}

/** The same outline as a CSS clip, for cutting a piece of the page to the container's
 *  exact shape - which is how the nudge can move the artist's own balloon without bringing
 *  the corner of a panel, the fire behind it or the balloon next to it along with it. */
export function comicBubbleClip(contour: readonly ComicContourPoint[], visual: NormalizedBounds): string | null {
  if (contour.length < 3) return null;
  const points = contour.map(point => {
    const x = ((point.x - visual.x) / Math.max(1e-6, visual.width)) * 100;
    const y = ((point.y - visual.y) / Math.max(1e-6, visual.height)) * 100;
    return `${round(Math.min(100, Math.max(0, x)))}% ${round(Math.min(100, Math.max(0, y)))}%`;
  });
  return `polygon(${points.join(", ")})`;
}

const round = (value: number): number => Math.round(value * 10) / 10;
