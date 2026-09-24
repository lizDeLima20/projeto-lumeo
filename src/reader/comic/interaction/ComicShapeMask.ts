import type { ComicRegionShape, ComicTailDirection } from "./ComicInteractionTypes";

/** A silhouette on a small grid: 1 where the container is, 0 where the page is. */
export interface ComicMask {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface ComicPoint2D { x: number; y: number }

export const emptyMask = (width: number, height: number): ComicMask => ({ width, height, data: new Uint8Array(width * height) });

/** Close only sampling-sized leaks, then fill enclosed ink. Lettering can connect to
 * the exterior through a one-cell break in the colour fill: that must not turn letters
 * into transparent holes. Padding keeps genuine page-edge contours from being eroded. */
export function sealComicArtMask(mask: ComicMask, radius = 2): ComicMask {
  const pad = radius + 1, width = mask.width + pad * 2, height = mask.height + pad * 2;
  let work = emptyMask(width, height);
  for (let y = 0; y < mask.height; y++) work.data.set(mask.data.subarray(y * mask.width, (y + 1) * mask.width), (y + pad) * width + pad);
  for (let i = 0; i < radius; i++) work = dilateMask(work);
  for (let i = 0; i < radius; i++) work = erodeMask(work);
  const outside = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let head = 0, tail = 1; outside[0] = 1;
  const visit = (i: number): void => { if (!work.data[i] && !outside[i]) { outside[i] = 1; queue[tail++] = i; } };
  while (head < tail) {
    const i = queue[head++]!, x = i % width, y = Math.floor(i / width);
    if (x > 0) visit(i - 1); if (x < width - 1) visit(i + 1);
    if (y > 0) visit(i - width); if (y < height - 1) visit(i + width);
  }
  const output = emptyMask(mask.width, mask.height);
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    output.data[y * mask.width + x] = outside[(y + pad) * width + x + pad] ? 0 : 1;
  }
  return output;
}

export function maskArea(mask: ComicMask): number {
  let area = 0;
  for (const value of mask.data) if (value) area++;
  return area;
}

/** Shrinks the silhouette by one pixel all round. */
export function erodeMask(mask: ComicMask): ComicMask {
  const { width, height, data } = mask, out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    if (!data[index]) continue;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) continue;
    if (data[index - 1] && data[index + 1] && data[index - width] && data[index + width]) out[index] = 1;
  }
  return { width, height, data: out };
}

/** Which piece each pixel belongs to, and how big each piece is - without building a
 *  separate silhouette per piece, which is wasteful when only the sizes are wanted. */
export function labelPieces(mask: ComicMask): { labels: Int32Array; sizes: number[] } {
  const { width, height, data } = mask;
  const labels = new Int32Array(data.length).fill(-1), queue = new Int32Array(data.length);
  const sizes: number[] = [];
  for (let start = 0; start < data.length; start++) {
    if (!data[start] || labels[start] !== -1) continue;
    const piece = sizes.length;
    let head = 0, tail = 1, size = 0;
    queue[0] = start; labels[start] = piece;
    while (head < tail) {
      const index = queue[head++]!, x = index % width, y = (index / width) | 0;
      size++;
      const visit = (next: number): void => { if (data[next] && labels[next] === -1) { labels[next] = piece; queue[tail++] = next; } };
      if (x > 0) visit(index - 1); if (x + 1 < width) visit(index + 1);
      if (y > 0) visit(index - width); if (y + 1 < height) visit(index + width);
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/** The connected pieces of a silhouette, largest first. */
export function labelMask(mask: ComicMask): ComicMask[] {
  const { width, height } = mask;
  const { labels, sizes } = labelPieces(mask);
  const pieces = sizes.map(() => new Uint8Array(mask.data.length));
  for (let index = 0; index < labels.length; index++) {
    const piece = labels[index]!;
    if (piece >= 0) pieces[piece]![index] = 1;
  }
  return pieces.map((data, index) => ({ mask: { width, height, data }, size: sizes[index]! }))
    .sort((a, b) => b.size - a.size).map(entry => entry.mask);
}

/* Two strategies for cutting one silhouette into several - wearing it down to find a
 * neck, and dividing it by the gaps between its blocks of lettering - used to live here.
 * Both were wrong about comics: a balloon drawn as two or three lobes running into each
 * other is one balloon, and the only thing that separates two balloons is the outline the
 * artist drew between them, which the fill already stops at. */

/** Gives every pixel of a silhouette to whichever seed reaches it first. */
export function shareBetween(mask: ComicMask, seeds: readonly ComicMask[]): ComicMask[] {
  const { width, height, data } = mask;
  const owner = new Int32Array(data.length).fill(-1), queue = new Int32Array(data.length);
  let head = 0, tail = 0;
  seeds.forEach((seed, index) => {
    for (let i = 0; i < seed.data.length; i++) if (seed.data[i] && data[i]) { owner[i] = index; queue[tail++] = i; }
  });
  if (tail === 0) return [mask];
  while (head < tail) {
    const index = queue[head++]!, x = index % width, y = (index / width) | 0;
    const visit = (next: number): void => { if (data[next] && owner[next] === -1) { owner[next] = owner[index]!; queue[tail++] = next; } };
    if (x > 0) visit(index - 1); if (x + 1 < width) visit(index + 1);
    if (y > 0) visit(index - width); if (y + 1 < height) visit(index + width);
  }
  const parts = seeds.map(() => new Uint8Array(data.length));
  for (let i = 0; i < data.length; i++) {
    const part = owner[i]!;
    if (data[i] && part >= 0) parts[part]![i] = 1;
  }
  return parts.map(part => ({ width, height, data: part })).filter(part => maskArea(part) > 0);
}

/** The tight box around a silhouette. */
export function maskBounds(mask: ComicMask): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = mask.width, minY = mask.height, maxX = -1, maxY = -1;
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    if (!mask.data[y * mask.width + x]) continue;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/** The outline of a silhouette, as a closed polygon walked clockwise.
 *
 *  Moore boundary tracing: from the first pixel found, keep the silhouette on one side and
 *  walk until the start comes round again. */
export function traceMaskContour(mask: ComicMask): ComicPoint2D[] {
  const { width, height, data } = mask;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && data[y * width + x] === 1;
  let startX = -1, startY = -1;
  for (let y = 0; y < height && startY < 0; y++) for (let x = 0; x < width; x++) {
    if (inside(x, y)) { startX = x; startY = y; break; }
  }
  if (startY < 0) return [];
  const steps = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
  const contour: ComicPoint2D[] = [];
  let x = startX, y = startY, direction = 6;
  const guard = width * height * 4;
  for (let count = 0; count < guard; count++) {
    contour.push({ x, y });
    let moved = false;
    for (let turn = 0; turn < 8; turn++) {
      const next = (direction + 6 + turn) % 8, [dx, dy] = steps[next]!;
      if (inside(x + dx, y + dy)) { x += dx; y += dy; direction = next; moved = true; break; }
    }
    if (!moved) break;
    if (x === startX && y === startY) break;
  }
  return contour;
}

/** Fewer points, same shape (Ramer-Douglas-Peucker). */
export function simplifyContour(points: readonly ComicPoint2D[], tolerance: number): ComicPoint2D[] {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    const a = points[from]!, b = points[to]!;
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
    let worst = -1, worstIndex = -1;
    for (let index = from + 1; index < to; index++) {
      const point = points[index]!;
      const distance = Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / length;
      if (distance > worst) { worst = distance; worstIndex = index; }
    }
    if (worst > tolerance && worstIndex > 0) {
      keep[worstIndex] = 1;
      stack.push([from, worstIndex], [worstIndex, to]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

export interface ComicShapeReading {
  shape: ComicRegionShape;
  /** How well the silhouette matches the shape it was called, from 0 to 1. */
  confidence: number;
  tail: ComicTailDirection;
}

/** What kind of container this silhouette is, and where its tail points.
 *
 *  A caption fills its box, an oval balloon covers about four fifths of it and leaves the
 *  corners empty, a thought cloud is the same but with a wavy edge, and a scream is spiky.
 *  The tail is whatever sticks out of the body once the body has been smoothed away. */
export function readMaskShape(mask: ComicMask, contour: readonly ComicPoint2D[]): ComicShapeReading {
  const bounds = maskBounds(mask);
  if (!bounds) return { shape: "unknown", confidence: 0, tail: "none" };
  const width = bounds.maxX - bounds.minX + 1, height = bounds.maxY - bounds.minY + 1;
  const area = maskArea(mask), boxArea = width * height;
  const fill = area / Math.max(1, boxArea);

  let perimeter = 0;
  for (let index = 1; index < contour.length; index++) {
    perimeter += Math.hypot(contour[index]!.x - contour[index - 1]!.x, contour[index]!.y - contour[index - 1]!.y);
  }
  if (contour.length > 2) perimeter += Math.hypot(contour[0]!.x - contour.at(-1)!.x, contour[0]!.y - contour.at(-1)!.y);
  // 1 for a circle, higher the more the edge wanders.
  const roughness = perimeter > 0 ? (perimeter * perimeter) / (4 * Math.PI * Math.max(1, area)) : 1;

  const corner = Math.max(1, Math.floor(Math.min(width, height) * .16));
  let corners = 0, cornerCells = 0;
  for (const [cx, cy] of [[bounds.minX, bounds.minY], [bounds.maxX - corner + 1, bounds.minY],
    [bounds.minX, bounds.maxY - corner + 1], [bounds.maxX - corner + 1, bounds.maxY - corner + 1]] as const) {
    for (let y = cy; y < cy + corner; y++) for (let x = cx; x < cx + corner; x++) {
      if (mask.data[y * mask.width + x]) corners++;
      cornerCells++;
    }
  }
  const cornerShare = cornerCells > 0 ? corners / cornerCells : 0;

  let shape: ComicRegionShape, confidence: number;
  if (cornerShare > .72 && fill > .82) { shape = "rectangle"; confidence = Math.min(1, fill); }
  else if (roughness > 1.9) { shape = fill > .62 ? "cloud" : "jagged"; confidence = Math.max(.35, Math.min(1, 2.6 - roughness)); }
  else if (cornerShare < .42 && fill > .58 && fill < .92) {
    shape = "balloon";
    // An ellipse fills pi/4 of its box; the closer, the surer.
    confidence = Math.max(.3, 1 - Math.abs(fill - Math.PI / 4) * 3);
  } else { shape = "freeform"; confidence = .3; }

  return { shape, confidence: Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100, tail: readTail(mask, bounds) };
}

/** The tail is what survives when the round body is smoothed off the silhouette. */
function readTail(mask: ComicMask, bounds: { minX: number; minY: number; maxX: number; maxY: number }): ComicTailDirection {
  const total = maskArea(mask);
  let core = mask;
  const rounds = Math.max(1, Math.floor(Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * .12));
  for (let step = 0; step < rounds; step++) core = erodeMask(core);
  const body = labelMask(core)[0];
  if (!body) return "none";
  let grown = body;
  for (let step = 0; step < rounds + 1; step++) grown = dilateMask(grown);

  let tailArea = 0, sumX = 0, sumY = 0;
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    const index = y * mask.width + x;
    if (mask.data[index] && !grown.data[index]) { tailArea++; sumX += x; sumY += y; }
  }
  if (tailArea < total * .015 || tailArea > total * .4) return "none";
  const centreX = (bounds.minX + bounds.maxX) / 2, centreY = (bounds.minY + bounds.maxY) / 2;
  const dx = sumX / tailArea - centreX, dy = sumY / tailArea - centreY;
  const width = bounds.maxX - bounds.minX + 1, height = bounds.maxY - bounds.minY + 1;
  const horizontal = Math.abs(dx) / width > .12 ? (dx > 0 ? "right" : "left") : "";
  const vertical = Math.abs(dy) / height > .12 ? (dy > 0 ? "down" : "up") : "";
  if (vertical && horizontal) return `${vertical}-${horizontal}` as ComicTailDirection;
  return (vertical || horizontal || "none") as ComicTailDirection;
}

/** Grows the silhouette by one cell in every direction, corners included. */
export function dilateMaskSquare(mask: ComicMask): ComicMask {
  const { width, height, data } = mask, out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!data[y * width + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ny = y + dy, nx = x + dx;
      if (ny >= 0 && nx >= 0 && ny < height && nx < width) out[ny * width + nx] = 1;
    }
  }
  return { width, height, data: out };
}

/** Grows the silhouette by one pixel all round. */
export function dilateMask(mask: ComicMask): ComicMask {
  const { width, height, data } = mask, out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    if (!data[index]) continue;
    out[index] = 1;
    if (x > 0) out[index - 1] = 1; if (x + 1 < width) out[index + 1] = 1;
    if (y > 0) out[index - width] = 1; if (y + 1 < height) out[index + width] = 1;
  }
  return { width, height, data: out };
}
