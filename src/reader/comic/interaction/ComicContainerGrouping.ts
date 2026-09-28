import type { ComicVisualContainer, ComicStencil } from "./ComicContainerDetector";
import { comicDistanceToContour, comicPointInContour } from "./ComicSilhouette";
import { dilateMask, emptyMask, erodeMask, simplifyContour, traceMaskContour, type ComicMask, type ComicPoint2D } from "./ComicShapeMask";

/** Two balloons the artist drew as one piece of speech, joined by a connector too thin to
 *  ever be the same flood fill: a short lead-in line, or the sliver where one balloon's
 *  own outline runs into the next. Detection finds them as two separate containers because
 *  they are - the connector is ink, not fill - so this is where they are read back
 *  together, the way task 3.5 already reads a single fill that happens to pinch in the
 *  middle. Nothing here touches how a container is found; it only decides, afterwards,
 *  which of the found containers belong to the same speech. */

/** How close two containers' own outlines may sit, and still be read as a stray gap
 *  between two speakers rather than a connector - a few grid cells at their own
 *  resolution, capped by a share of how big the smaller one is so two large boxes never
 *  bridge across a whole panel. */
function gapLimit(a: ComicVisualContainer, b: ComicVisualContainer): number {
  // A simplified contour cuts corners on a curve, so a real gap this size can measure a
  // little larger than it is - the margin below is headroom for that rounding, not an
  // invitation to bridge a genuine gap between two unrelated balloons.
  const steps = Math.max(a.stencil.step, b.stencil.step) * 14;
  const smaller = Math.min(a.bbox.x1 - a.bbox.x0, a.bbox.y1 - a.bbox.y0, b.bbox.x1 - b.bbox.x0, b.bbox.y1 - b.bbox.y0);
  return Math.min(steps, Math.max(6, smaller * .35));
}

/** Whichever two points, one from each outline, are nearest each other - where a real
 *  connector would run. */
function nearestPoints(a: readonly ComicPoint2D[], b: readonly ComicPoint2D[]): { from: ComicPoint2D; to: ComicPoint2D; distance: number } {
  let best = { from: a[0]!, to: b[0]!, distance: Number.POSITIVE_INFINITY };
  for (const from of a) {
    const distance = comicDistanceToContour(b, from);
    if (distance < best.distance) best = { from, to: nearestOn(b, from), distance };
  }
  return best;
}

function nearestOn(contour: readonly ComicPoint2D[], point: ComicPoint2D): ComicPoint2D {
  let best = contour[0]!, bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0, previous = contour.length - 1; index < contour.length; previous = index++) {
    const a = contour[previous]!, b = contour[index]!, dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
    const candidate = { x: a.x + dx * t, y: a.y + dy * t };
    const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (distance < bestDistance) { bestDistance = distance; best = candidate; }
  }
  return best;
}

/** How much the two containers overlap along the axis across their gap - the test for a
 *  real chain (one lettered box leading into the next) rather than two balloons that just
 *  happen to share a colour on opposite sides of the page. */
function crossAxisOverlap(a: ComicVisualContainer, b: ComicVisualContainer): number {
  const vertical = Math.abs((a.bbox.y0 + a.bbox.y1) / 2 - (b.bbox.y0 + b.bbox.y1) / 2)
    >= Math.abs((a.bbox.x0 + a.bbox.x1) / 2 - (b.bbox.x0 + b.bbox.x1) / 2);
  const [aFrom, aTo, bFrom, bTo] = vertical ? [a.bbox.x0, a.bbox.x1, b.bbox.x0, b.bbox.x1] : [a.bbox.y0, a.bbox.y1, b.bbox.y0, b.bbox.y1];
  const overlap = Math.max(0, Math.min(aTo, bTo) - Math.max(aFrom, bFrom));
  const narrower = Math.min(aTo - aFrom, bTo - bFrom);
  return narrower > 0 ? overlap / narrower : 0;
}

/** Close enough in colour to be the same artwork, not two unrelated boxes that happen to
 *  sit near each other. */
function styleMatches(a: ComicVisualContainer, b: ComicVisualContainer): boolean {
  if (a.darkOnLight !== b.darkOnLight) return false;
  const distance = (x?: string, y?: string): number => {
    if (!x || !y || !/^#[0-9a-f]{6}$/i.test(x) || !/^#[0-9a-f]{6}$/i.test(y)) return 0;
    const px = Number.parseInt(x.slice(1), 16), py = Number.parseInt(y.slice(1), 16);
    return Math.hypot(((px >> 16) & 255) - ((py >> 16) & 255), ((px >> 8) & 255) - ((py >> 8) & 255), (px & 255) - (py & 255));
  };
  return distance(a.backgroundColor, b.backgroundColor) <= 40;
}

/** Whether `b` is close enough, aligned enough and coloured alike enough that a reader
 *  sees `a` and `b` as one speech running from one balloon into the next. */
export function comicContainersLookConnected(a: ComicVisualContainer, b: ComicVisualContainer): boolean {
  if (a.type !== b.type || (a.type !== "speech" && a.type !== "thought")) return false;
  if (a.shape === "rectangle" || b.shape === "rectangle") return false;
  if (!styleMatches(a, b)) return false;
  if (a.contour.length < 3 || b.contour.length < 3) return false;
  const gap = nearestPoints(a.contour, b.contour).distance;
  if (gap > gapLimit(a, b)) return false;
  return crossAxisOverlap(a, b) >= .18;
}

/** The bridge between two containers: the strip of page they both come close to. Two
 *  balloons stacked with their widths overlapping are joined by that whole overlap, the
 *  same width top to bottom - not by a single line between two corners, which would
 *  connect them at one edge and leave the rest of the gap looking cut. Only when they do
 *  not overlap along that axis at all does the connector fall back to the line between
 *  their nearest points, for a tail-and-line join at an angle. */
function bridgeTest(a: ComicVisualContainer, b: ComicVisualContainer, step: number): (px: number, py: number) => boolean {
  const vertical = Math.abs((a.bbox.y0 + a.bbox.y1) / 2 - (b.bbox.y0 + b.bbox.y1) / 2)
    >= Math.abs((a.bbox.x0 + a.bbox.x1) / 2 - (b.bbox.x0 + b.bbox.x1) / 2);
  const overlapFrom = vertical ? Math.max(a.bbox.x0, b.bbox.x0) : Math.max(a.bbox.y0, b.bbox.y0);
  const overlapTo = vertical ? Math.min(a.bbox.x1, b.bbox.x1) : Math.min(a.bbox.y1, b.bbox.y1);
  if (overlapTo > overlapFrom) {
    const gapFrom = vertical ? Math.min(a.bbox.y1, b.bbox.y1) : Math.min(a.bbox.x1, b.bbox.x1);
    const gapTo = vertical ? Math.max(a.bbox.y0, b.bbox.y0) : Math.max(a.bbox.x0, b.bbox.x0);
    const pad = step * .5;
    return vertical
      ? (px, py) => px >= overlapFrom - pad && px <= overlapTo + pad && py >= gapFrom - pad && py <= gapTo + pad
      : (px, py) => py >= overlapFrom - pad && py <= overlapTo + pad && px >= gapFrom - pad && px <= gapTo + pad;
  }
  const bridge = nearestPoints(a.contour, b.contour);
  const half = Math.max(step, bridge.distance * .4);
  const dx = bridge.to.x - bridge.from.x, dy = bridge.to.y - bridge.from.y, length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length, ny = dx / length;
  return (px, py) => {
    const t = ((px - bridge.from.x) * dx + (py - bridge.from.y) * dy) / (length * length);
    if (t < -.15 || t > 1.15) return false;
    const lateral = Math.abs((px - bridge.from.x) * nx + (py - bridge.from.y) * ny);
    return lateral <= half;
  };
}

/** One container that answers for two, drawn again as the union of both outlines plus a
 *  short bridge across the gap between them - exactly wide enough to read as continuous,
 *  never wider than the gap it closes. */
function mergeContainers(a: ComicVisualContainer, b: ComicVisualContainer): ComicVisualContainer {
  const step = Math.min(a.stencil.step, b.stencil.step);
  const x0 = Math.min(a.bbox.x0, b.bbox.x0) - step, y0 = Math.min(a.bbox.y0, b.bbox.y0) - step;
  const x1 = Math.max(a.bbox.x1, b.bbox.x1) + step, y1 = Math.max(a.bbox.y1, b.bbox.y1) + step;
  const originCellX = Math.floor(x0 / step), originCellY = Math.floor(y0 / step);
  const width = Math.max(1, Math.ceil(x1 / step) - originCellX), height = Math.max(1, Math.ceil(y1 / step) - originCellY);
  const onBridge = bridgeTest(a, b, step);

  const mask: ComicMask = emptyMask(width, height);
  for (let cy = 0; cy < height; cy++) for (let cx = 0; cx < width; cx++) {
    const px = (originCellX + cx + .5) * step, py = (originCellY + cy + .5) * step;
    if (comicPointInContour(a.contour, { x: px, y: py }) || comicPointInContour(b.contour, { x: px, y: py }) || onBridge(px, py)) {
      mask.data[cy * width + cx] = 1;
    }
  }
  // One light pass to weld the rasterised join into the same silhouette a flood fill
  // would have found, without rounding off the balloons' own shape.
  const sealed = erodeMask(dilateMask(mask));
  const contour = simplifyContour(traceMaskContour(sealed), 1.1)
    .map(point => ({ x: (originCellX + point.x) * step, y: (originCellY + point.y) * step }));

  const data = new Uint8Array(sealed.data);
  const stencil: ComicStencil = { data, width, height, step, x: originCellX * step, y: originCellY * step };
  const larger = (a.bbox.x1 - a.bbox.x0) * (a.bbox.y1 - a.bbox.y0) >= (b.bbox.x1 - b.bbox.x0) * (b.bbox.y1 - b.bbox.y0) ? a : b;
  return {
    ...larger, bbox: { x0, y0, x1, y1 }, ink: { x0: Math.min(a.ink.x0, b.ink.x0), y0: Math.min(a.ink.y0, b.ink.y0),
      x1: Math.max(a.ink.x1, b.ink.x1), y1: Math.max(a.ink.y1, b.ink.y1) },
    contour, stencil, artStencil: stencil, artBbox: { x0, y0, x1, y1 },
    shape: "freeform", tail: a.tail !== "none" ? a.tail : b.tail,
    styleConfidence: Math.max(a.styleConfidence, b.styleConfidence),
    inkShare: Math.max(a.inkShare, b.inkShare), blockShare: Math.max(a.blockShare, b.blockShare),
    runs: a.runs + b.runs, glyphShare: Math.max(a.glyphShare, b.glyphShare), bands: a.bands + b.bands,
  };
}

/** Every container, with the ones that read as one connected speech folded into a single
 *  container each - so the rest of the pipeline (line grouping, `bubbleGroup` members,
 *  cutout, hit-test) sees exactly what it already knows how to read: one outline holding
 *  more than one line group, the same shape a single pinched fill produces. Independent
 *  containers, including a small balloon sitting between two connected ones, are returned
 *  exactly as they were found. */
export function comicGroupConnectedContainers(containers: readonly ComicVisualContainer[]): ComicVisualContainer[] {
  const remaining = [...containers];
  const result: ComicVisualContainer[] = [];
  while (remaining.length > 0) {
    let current = remaining.shift()!;
    for (let index = 0; index < remaining.length;) {
      if (comicContainersLookConnected(current, remaining[index]!)) { current = mergeContainers(current, remaining[index]!); remaining.splice(index, 1); index = 0; }
      else index++;
    }
    result.push(current);
  }
  return result;
}
