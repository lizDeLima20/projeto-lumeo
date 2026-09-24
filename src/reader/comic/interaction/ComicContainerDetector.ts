import type { Bbox } from "tesseract.js";
import type { ComicRegionShape, ComicRegionType, ComicTailDirection, ComicTypography } from "./ComicInteractionTypes";
import { dilateMask, emptyMask, labelMask, maskArea, maskBounds, readMaskShape, sealComicArtMask, shareBetween, simplifyContour, splitByTextBlocks, splitTouchingMasks, traceMaskContour, type ComicMask, type ComicPoint2D } from "./ComicShapeMask";

export interface ComicVisualContainer {
  /** The container itself: balloon, caption box, coloured panel of text. */
  bbox: Bbox;
  /** The letters inside it, as a block. Empty containers do not reach the caller. */
  ink: Bbox;
  /** The silhouette, in image pixels: exactly which pixels are the container and which
   *  are the drawing behind it. This is what keeps the scenery out of an enlarged
   *  balloon, and what tells two balloons drawn touching apart. */
  contour: ComicPoint2D[];
  /** The same silhouette as a stencil, kept for the conversion only: it lets a region be
   *  read with everything outside it painted out, so the balloon next door cannot lend it
   *  half a letter. Never written to the .lima - the outline above is what is stored. */
  stencil: ComicStencil;
  /** Untrimmed original component: narrow tails belong to the art even when excluded
   * from the dense body used for text detection. */
  artStencil?: ComicStencil;
  artBbox?: Bbox;
  type: ComicRegionType;
  shape: ComicRegionShape;
  tail: ComicTailDirection;
  /** How sure the shape reading is, from 0 to 1. */
  styleConfidence: number;
  /** Sampled from the artwork, as `#rrggbb`. */
  backgroundColor: string;
  textColor: string;
  borderColor?: string;
  typography: ComicTypography;
  /** Share of the container covered by letters, how many separate marks were counted, and
   *  how much of the ink sits in glyph-sized marks: the evidence that made this a container
   *  rather than a patch of flat artwork with a shadow on it. */
  inkShare: number;
  /** Density of the marks inside the block of text itself, which does not fall just
   *  because a balloon holds one short line in a lot of empty space. */
  blockShare: number;
  runs: number;
  glyphShare: number;
  /** Rows of text, counted as bands of marked lines separated by clear gaps. */
  bands: number;
  darkOnLight: boolean;
}

/** A container that looks so much like a caption or a balloon that losing it would be
 *  worse than keeping it unread - and, by the same measure, the only kind of container
 *  allowed to claim what sits inside it. Measured against the balloons and captions of a
 *  real comic: a box of text is densely and evenly marked, and nearly every mark in it is
 *  the size of a letter. A face, a flame or a fold of cloth fails on one of those even
 *  when it happens to enclose something. */
export function comicContainerIsConvincing(container: ComicVisualContainer): boolean {
  return container.shape !== "freeform" && container.blockShare >= .2 && container.blockShare <= .62
    && container.runs >= 45 && container.glyphShare >= .9 && container.bands >= 1 && container.bands <= 6;
}

export interface ComicContainerOptions {
  /** Sampling step in image pixels. Two keeps a 2400px page under three megacells. */
  step?: number;
  /** How far neighbouring pixels may differ and still belong to the same fill. Small: an
   *  inked outline is a cliff, the shading inside a balloon is a slope. */
  tolerance?: number;
  /** How far the fill may wander from its seed colour in total. Without this ceiling a
   *  gentle slope would walk from a cream balloon out into the flames around it. */
  drift?: number;
  /** The brightness step that counts as a drawn line rather than shading. */
  edge?: number;
}

const hex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map(value => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0")).join("")}`;

/** A container's silhouette on the sampling grid, with where that grid sits on the page. */
export interface ComicStencil {
  data: Uint8Array; width: number; height: number;
  /** Page pixels per cell, and the page pixel the grid starts at. */
  step: number; x: number; y: number;
}

interface Grid {
  width: number; height: number;
  red: Uint8Array; green: Uint8Array; blue: Uint8Array; luma: Uint8Array;
}

/** Every flat area that holds letters, whatever colour it is, as a shape rather than a box.
 *
 *  The fill is grown from its own seed colour with a tolerance and stopped at drawn lines,
 *  so white, yellow, blue and black are the same case and a cream balloon does not bleed
 *  into the cream fire behind it. What the fill encloses is then measured: a text container
 *  holds many short marks arranged in rows. Finally the silhouette is split where two
 *  balloons were drawn touching, and each one leaves with its own outline, colours and
 *  lettering - everything the reader needs to draw that balloon again by itself. */
export function detectComicContainers(image: ImageData, options: ComicContainerOptions = {}): ComicVisualContainer[] {
  const step = Math.max(1, Math.floor(options.step ?? 2)), tolerance = options.tolerance ?? 22, drift = options.drift ?? 120;
  const width = Math.ceil(image.width / step), height = Math.ceil(image.height / step), cells = width * height;
  if (width < 8 || height < 8) return [];
  const red = new Uint8Array(cells), green = new Uint8Array(cells), blue = new Uint8Array(cells), luma = new Uint8Array(cells);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (Math.min(image.height - 1, y * step) * image.width + Math.min(image.width - 1, x * step)) * 4, cell = y * width + x;
    const r = image.data[offset]!, g = image.data[offset + 1]!, b = image.data[offset + 2]!;
    red[cell] = r; green[cell] = g; blue[cell] = b; luma[cell] = (r * 54 + g * 183 + b * 19) >> 8;
  }
  const grid: Grid = { width, height, red, green, blue, luma };

  // Colour alone cannot tell a cream balloon from the cream fire it is drawn over. What
  // tells them apart is the line the artist drew between them, so every sharp step in
  // brightness becomes a wall the fill may not cross, and each fill stays in its own shape.
  const wall = new Uint8Array(cells), edge = options.edge ?? 64;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = y * width + x;
    const horizontal = Math.abs(luma[x + 1 < width ? cell + 1 : cell]! - luma[x > 0 ? cell - 1 : cell]!);
    const vertical = Math.abs(luma[y + 1 < height ? cell + width : cell]! - luma[y > 0 ? cell - width : cell]!);
    if (Math.max(horizontal, vertical) >= edge) wall[cell] = 1;
  }

  const owner = new Int32Array(cells).fill(-1), queue = new Int32Array(cells), found: ComicVisualContainer[] = [];
  const minWidth = 16, minHeight = 8;
  for (let seed = 0; seed < cells; seed++) {
    if (owner[seed] !== -1 || wall[seed]) continue;
    const seedR = red[seed]!, seedG = green[seed]!, seedB = blue[seed]!;
    let head = 0, tail = 1, minX = width, minY = height, maxX = 0, maxY = 0;
    queue[0] = seed; owner[seed] = seed;
    while (head < tail) {
      const position = queue[head++]!, x = position % width, y = (position / width) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      const here = position;
      const visit = (next: number): void => {
        if (owner[next] !== -1 || wall[next]) return;
        const near = Math.abs(red[next]! - red[here]!) <= tolerance && Math.abs(green[next]! - green[here]!) <= tolerance && Math.abs(blue[next]! - blue[here]!) <= tolerance;
        const home = Math.abs(red[next]! - seedR) <= drift && Math.abs(green[next]! - seedG) <= drift && Math.abs(blue[next]! - seedB) <= drift;
        if (near && home) { owner[next] = seed; queue[tail++] = next; }
      };
      if (x > 0) visit(position - 1); if (x + 1 < width) visit(position + 1);
      if (y > 0) visit(position - width); if (y + 1 < height) visit(position + width);
    }
    if (tail < 48) continue;
    // A fill rarely stops at the balloon: a highlight of the same colour in the artwork
    // next to it, or the thread of a tail, drags the bounding box across the panel and
    // makes a perfectly good balloon look sparse. Rows and columns that hold almost
    // nothing are shaved off before the shape is judged, which leaves the body itself.
    const originalBox = { minX, minY, maxX, maxY };
    const body = trimToBody(owner, seed, width, minX, minY, maxX, maxY);
    if (!body) continue;
    ({ minX, minY, maxX, maxY } = body);
    const boxWidth = maxX - minX + 1, boxHeight = maxY - minY + 1, area = boxWidth * boxHeight;
    // A page margin, a speck, a whole panel or a ragged silhouette is not a text container.
    if (minX === 0 || minY === 0 || maxX === width - 1 || maxY === height - 1) continue;
    // A whole panel is not a balloon: above an eighth of the page this is the drawing.
    if (boxWidth < minWidth || boxHeight < minHeight || boxWidth > width * .78 || boxHeight > height * .5
      || area > cells * .12 || area < cells * .0004) continue;
    // A ring of drawn line, not a body: cheap reject before the enclosure is computed.
    if (body.count / area < .22) continue;

    const silhouette = bodyMask(owner, seed, grid, { minX, minY, maxX, maxY });
    const group: ComicVisualContainer[] = [];
    // Two balloons can be one silhouette in two different ways: pinched at a neck, or
    // simply drawn merged. The first is found by wearing the shape down, the second by
    // the gap between the blocks of lettering it holds.
    for (const pinched of splitTouchingMasks(silhouette.body)) {
      const ink = inkMask(pinched, silhouette.fill, grid, { minX, minY });
      const reach = Math.max(2, Math.round(Math.min(boxWidth, boxHeight) * .07));
      for (const part of splitByTextBlocks(pinched, ink, reach)) {
        const container = describe(part, silhouette.fill, grid, { minX, minY }, step, image, minWidth, minHeight);
        if (container) { found.push(container); group.push(container); }
      }
    }
    // Detection trims sparse rows to reject scenery. Extraction must recover tails.
    // Only recover a bounded component; a fill leaking across a panel stays for review.
    const fullWidth = originalBox.maxX - originalBox.minX + 1, fullHeight = originalBox.maxY - originalBox.minY + 1;
    if (group.length && fullWidth * fullHeight <= area * 2.5 && fullWidth <= boxWidth * 2 && fullHeight <= boxHeight * 2.5) {
      const full = sealComicArtMask(bodyMask(owner, seed, grid, originalBox).body);
      const seeds = group.map(container => {
        const mask = emptyMask(full.width, full.height), s = container.stencil;
        const ox = Math.round(s.x / step) - originalBox.minX, oy = Math.round(s.y / step) - originalBox.minY;
        for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) if (s.data[y * s.width + x]) mask.data[(oy + y) * full.width + ox + x] = 1;
        return mask;
      });
      const restored = group.length === 1 ? [full] : shareBetween(full, seeds);
      if (restored.length === group.length) restored.forEach((mask, index) => {
        const b = maskBounds(mask); if (!b) return;
        group[index]!.artStencil = { ...mask, x: originalBox.minX * step, y: originalBox.minY * step, step };
        group[index]!.artBbox = { x0: (originalBox.minX + b.minX) * step, y0: (originalBox.minY + b.minY) * step,
          x1: Math.min(image.width, (originalBox.minX + b.maxX + 1) * step), y1: Math.min(image.height, (originalBox.minY + b.maxY + 1) * step) };
      });
    }
  }

  // Containers nest both ways round. A caption box may sit on a wide flat background, and
  // a fat display letter may sit inside a balloon and hold marks of its own. The outer one
  // is the one to drop when it is large and thinly marked - a backdrop - and otherwise the
  // inner one is a detail of the container that holds it.
  const pageArea = image.width * image.height;
  const box = (region: ComicVisualContainer): number => (region.bbox.x1 - region.bbox.x0) * (region.bbox.y1 - region.bbox.y0);
  const contains = (outer: ComicVisualContainer, inner: ComicVisualContainer): boolean =>
    outer !== inner && outer.bbox.x0 <= inner.bbox.x0 && outer.bbox.y0 <= inner.bbox.y0
    && outer.bbox.x1 >= inner.bbox.x1 && outer.bbox.y1 >= inner.bbox.y1 && box(outer) > box(inner) * 1.25;
  const backdrop = (region: ComicVisualContainer): boolean => box(region) > pageArea * .03 && region.inkShare < .06;
  // Only something shaped like a box or a balloon may claim what sits inside it. A ragged
  // fill - a column of fire, a silhouette - encloses a caption by accident, and a wide
  // thinly marked fill is a backdrop: neither gets to swallow a real container.
  const swallows = (outer: ComicVisualContainer, inner: ComicVisualContainer): boolean =>
    contains(outer, inner) && comicContainerIsConvincing(outer) && !backdrop(outer);
  const kept = found.filter(region => {
    if (found.some(other => swallows(other, region))) return false;
    return !(backdrop(region) && found.some(other => contains(region, other)));
  });
  return kept.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
}

interface Box { minX: number; minY: number; maxX: number; maxY: number }

/** The container as a silhouette: the fill, plus everything the fill encloses - its
 *  letters and the lines around them. Whatever can be reached from the edge of the box
 *  without crossing the fill is the drawing behind, and stays out. */
function bodyMask(owner: Int32Array, seed: number, grid: Grid, box: Box): { body: ComicMask; fill: ComicMask } {
  const width = box.maxX - box.minX + 1, height = box.maxY - box.minY + 1;
  const fill = emptyMask(width, height), body = emptyMask(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (owner[(y + box.minY) * grid.width + x + box.minX] === seed) fill.data[y * width + x] = 1;
  }
  const outside = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let head = 0, tail = 0;
  const enter = (index: number): void => { if (!fill.data[index] && !outside[index]) { outside[index] = 1; queue[tail++] = index; } };
  for (let x = 0; x < width; x++) { enter(x); enter((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { enter(y * width); enter(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++]!, x = index % width, y = (index / width) | 0;
    if (x > 0) enter(index - 1); if (x + 1 < width) enter(index + 1);
    if (y > 0) enter(index - width); if (y + 1 < height) enter(index + width);
  }
  for (let index = 0; index < body.data.length; index++) body.data[index] = outside[index] ? 0 : 1;
  return { body, fill };
}

/** The letters inside a silhouette: what it holds that is not its own colour. */
function inkMask(part: ComicMask, fill: ComicMask, grid: Grid, origin: { minX: number; minY: number }): ComicMask {
  const ink = emptyMask(part.width, part.height);
  let sum = 0, count = 0;
  for (let index = 0; index < part.data.length; index++) {
    if (!part.data[index] || !fill.data[index]) continue;
    sum += grid.luma[(origin.minY + ((index / part.width) | 0)) * grid.width + origin.minX + (index % part.width)]!;
    count++;
  }
  if (count === 0) return ink;
  const background = sum / count;
  for (let index = 0; index < part.data.length; index++) {
    if (!part.data[index] || fill.data[index]) continue;
    const cell = (origin.minY + ((index / part.width) | 0)) * grid.width + origin.minX + (index % part.width);
    if (Math.abs(grid.luma[cell]! - background) >= 46) ink.data[index] = 1;
  }
  return ink;
}

/** One silhouette, measured and described - or rejected. */
function describe(part: ComicMask, fill: ComicMask, grid: Grid, origin: { minX: number; minY: number },
  step: number, image: ImageData, minWidth: number, minHeight: number): ComicVisualContainer | null {
  const bounds = maskBounds(part);
  if (!bounds) return null;
  const width = bounds.maxX - bounds.minX + 1, height = bounds.maxY - bounds.minY + 1;
  if (width < minWidth || height < minHeight) return null;
  if (maskArea(part) < width * height * .38) return null;

  const evidence = measureInk(part, fill, grid, origin, bounds);
  if (!evidence) return null;

  const contour = simplifyContour(traceMaskContour(part), 1.1);
  if (contour.length < 4) return null;
  const reading = readMaskShape(part, contour);
  const rectangle = reading.shape === "rectangle";

  const outline = dilateMask(part);
  const ring: number[] = [];
  for (let index = 0; index < outline.data.length; index++) if (outline.data[index] && !part.data[index]) ring.push(index);
  const border = colourOf(ring, grid, origin, part.width);
  const background = colourOf(evidence.fillCells, grid, origin, part.width);
  const text = colourOf(evidence.inkCells, grid, origin, part.width);
  const bordered = border && Math.abs(border.luma - background!.luma) > 34;

  return {
    bbox: { x0: (origin.minX + bounds.minX) * step, y0: (origin.minY + bounds.minY) * step,
      x1: Math.min(image.width, (origin.minX + bounds.maxX + 1) * step), y1: Math.min(image.height, (origin.minY + bounds.maxY + 1) * step) },
    ink: { x0: (origin.minX + evidence.minX) * step, y0: (origin.minY + evidence.minY) * step,
      x1: Math.min(image.width, (origin.minX + evidence.maxX + 1) * step), y1: Math.min(image.height, (origin.minY + evidence.maxY + 1) * step) },
    contour: contour.map(point => ({ x: (origin.minX + point.x) * step, y: (origin.minY + point.y) * step })),
    stencil: { data: part.data, width: part.width, height: part.height, step, x: origin.minX * step, y: origin.minY * step },
    type: rectangle ? "caption" : reading.shape === "cloud" ? "thought" : reading.shape === "balloon" || reading.shape === "jagged" ? "speech" : "other",
    shape: reading.shape, tail: reading.tail, styleConfidence: reading.confidence,
    backgroundColor: background ? background.hex : "#ffffff",
    textColor: text ? text.hex : "#111111",
    borderColor: bordered ? border!.hex : undefined,
    // Cap height leaves here normalized to the page, which is how the reader will need it.
    typography: { ...evidence.typography, capHeight: (evidence.typography.capHeight * step) / image.height },
    inkShare: evidence.share, blockShare: evidence.blockShare, runs: evidence.runs,
    glyphShare: evidence.glyphShare, bands: evidence.bands, darkOnLight: evidence.darkOnLight,
  };
}

interface InkEvidence {
  minX: number; minY: number; maxX: number; maxY: number;
  share: number; blockShare: number; runs: number; glyphShare: number; bands: number;
  darkOnLight: boolean; inkCells: number[]; fillCells: number[]; typography: ComicTypography;
}

/** Letters, as opposed to a shadow, an outline or the drawing behind the balloon.
 *
 *  Only what the silhouette holds counts, and only where it differs from the container's
 *  own colour. Letters are many small marks in rows; eyebrows, lips and folds of cloth are
 *  long ones, and a fill that only holds those is a drawing the flood happened to enclose. */
function measureInk(part: ComicMask, fill: ComicMask, grid: Grid, origin: { minX: number; minY: number }, bounds: Box): InkEvidence | null {
  const width = part.width;
  const boxWidth = bounds.maxX - bounds.minX + 1, boxHeight = bounds.maxY - bounds.minY + 1, size = boxWidth * boxHeight;
  const fillCells: number[] = [];
  for (let index = 0; index < part.data.length; index++) if (part.data[index] && fill.data[index]) fillCells.push(index);
  if (fillCells.length === 0) return null;
  let sum = 0;
  for (const index of fillCells) sum += grid.luma[(origin.minY + ((index / width) | 0)) * grid.width + origin.minX + (index % width)]!;
  const background = sum / fillCells.length;

  const contrast = 46, longRunLimit = Math.max(3, Math.floor(boxWidth * .5)), glyphLimit = Math.max(2, Math.floor(boxWidth * .14));
  const inkCells: number[] = [];
  let runs = 0, darker = 0, textRows = 0, longRunCells = 0, holes = 0, glyphCells = 0, bands = 0, inBand = 0;
  let inkMinX = bounds.maxX, inkMinY = bounds.maxY, inkMaxX = bounds.minX, inkMaxY = bounds.minY;
  const bandRows: { top: number; bottom: number; left: number; right: number }[] = [];
  let strokeTotal = 0, strokeCount = 0;
  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    let run = 0, rowInk = 0, rowLeft = -1, rowRight = -1;
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const index = y * width + x;
      const cell = (origin.minY + y) * grid.width + origin.minX + x;
      const hole = part.data[index] === 1 && !fill.data[index];
      if (hole) holes++;
      const mark = hole && Math.abs(grid.luma[cell]! - background) >= contrast;
      if (mark) {
        inkCells.push(index); rowInk++; run++;
        if (grid.luma[cell]! < background) darker++;
        if (x < inkMinX) inkMinX = x; if (x > inkMaxX) inkMaxX = x;
        if (y < inkMinY) inkMinY = y; if (y > inkMaxY) inkMaxY = y;
        if (rowLeft < 0) rowLeft = x;
        rowRight = x;
      } else if (run > 0) {
        runs++; if (run > longRunLimit) longRunCells += run;
        if (run <= glyphLimit) { glyphCells += run; strokeTotal += run; strokeCount++; }
        run = 0;
      }
    }
    if (run > 0) { runs++; if (run > longRunLimit) longRunCells += run; if (run <= glyphLimit) { glyphCells += run; strokeTotal += run; strokeCount++; } }
    if (rowInk >= 2) {
      textRows++;
      if (inBand === 0) { bands++; bandRows.push({ top: y, bottom: y, left: rowLeft, right: rowRight }); }
      else { const band = bandRows.at(-1)!; band.bottom = y; band.left = Math.min(band.left, rowLeft); band.right = Math.max(band.right, rowRight); }
      inBand = 2;
    } else if (inBand > 0) inBand--;
  }
  const ink = inkCells.length;
  if (ink === 0) return null;
  const share = ink / size, rows = textRows / boxHeight;
  if (share < .01 || share > .45) return null;
  if (runs < 4 || longRunCells > ink * .4) return null;
  if (rows < .08 || rows > .96) return null;
  if (ink < holes * .35) return null;
  if (glyphCells < ink * .34) return null;
  if (inkMaxX - inkMinX + 1 < 6 || inkMaxY - inkMinY + 1 < 3) return null;

  return {
    minX: inkMinX, minY: inkMinY, maxX: inkMaxX, maxY: inkMaxY,
    share, blockShare: ink / Math.max(1, (inkMaxX - inkMinX + 1) * (inkMaxY - inkMinY + 1)),
    runs, glyphShare: glyphCells / ink, bands, darkOnLight: darker >= ink / 2, inkCells, fillCells,
    typography: readTypography(bandRows, strokeCount > 0 ? strokeTotal / strokeCount : 1, { minX: inkMinX, maxX: inkMaxX }),
  };
}

/** What the lettering looks like, from the shape of the marks themselves: how tall the
 *  lines are, how thick the strokes are, and how the lines sit against each other. The
 *  typeface is not named - comics letter by hand - only measured well enough to set the
 *  text again at a readable size, weight and alignment. */
function readTypography(bands: readonly { top: number; bottom: number; left: number; right: number }[],
  stroke: number, ink: { minX: number; maxX: number }): ComicTypography {
  const heights = bands.map(band => band.bottom - band.top + 1).sort((a, b) => a - b);
  const capHeight = heights.length > 0 ? heights[Math.floor(heights.length / 2)]! : 0;
  const weight: ComicTypography["weight"] = capHeight > 0 && stroke / capHeight > .17 ? "bold" : "normal";
  const blockWidth = Math.max(1, ink.maxX - ink.minX + 1);
  let align: ComicTypography["align"] = "center";
  if (bands.length >= 2) {
    const leftSpread = spread(bands.map(band => band.left)), rightSpread = spread(bands.map(band => band.right));
    const centreSpread = spread(bands.map(band => (band.left + band.right) / 2));
    if (leftSpread < blockWidth * .06 && leftSpread < centreSpread) align = "left";
    else if (rightSpread < blockWidth * .06 && rightSpread < centreSpread) align = "right";
  }
  // Comics are lettered by hand; a rounded face reads closest without claiming a name.
  return { family: "comic", weight, italic: false, align, capHeight, lines: bands.length };
}

const spread = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);

/** The colour most of these cells actually are, found by vote rather than by average, so a
 *  white balloon does not come out grey because of the letters at its edges. */
function colourOf(cells: readonly number[], grid: Grid, origin: { minX: number; minY: number }, width: number):
{ hex: string; luma: number } | null {
  if (cells.length === 0) return null;
  const votes = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (const index of cells) {
    const cell = (origin.minY + ((index / width) | 0)) * grid.width + origin.minX + (index % width);
    const r = grid.red[cell]!, g = grid.green[cell]!, b = grid.blue[cell]!;
    const bucket = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
    const entry = votes.get(bucket) ?? { count: 0, r: 0, g: 0, b: 0 };
    entry.count++; entry.r += r; entry.g += g; entry.b += b;
    votes.set(bucket, entry);
  }
  let best = { count: 0, r: 0, g: 0, b: 0 };
  for (const entry of votes.values()) if (entry.count > best.count) best = entry;
  const r = best.r / best.count, g = best.g / best.count, b = best.b / best.count;
  return { hex: hex(r, g, b), luma: (r * 54 + g * 183 + b * 19) / 256 };
}

/** The dense body of a fill: the box left after shaving rows and columns that hold almost
 *  none of it. Returns null when nothing dense enough survives. */
function trimToBody(owner: Int32Array, seed: number, width: number, minX: number, minY: number, maxX: number, maxY: number):
{ minX: number; minY: number; maxX: number; maxY: number; count: number } | null {
  const boxWidth = maxX - minX + 1, boxHeight = maxY - minY + 1;
  const rows = new Int32Array(boxHeight), columns = new Int32Array(boxWidth);
  for (let y = 0; y < boxHeight; y++) for (let x = 0; x < boxWidth; x++) {
    if (owner[(y + minY) * width + x + minX] === seed) { rows[y]!++; columns[x]!++; }
  }
  const shave = (counts: Int32Array): { from: number; to: number } | null => {
    let peak = 0;
    for (const value of counts) peak = Math.max(peak, value);
    const floor = Math.max(1, peak * .15);
    let from = 0, to = counts.length - 1;
    while (from <= to && counts[from]! < floor) from++;
    while (to >= from && counts[to]! < floor) to--;
    return to >= from ? { from, to } : null;
  };
  const vertical = shave(rows), horizontal = shave(columns);
  if (!vertical || !horizontal) return null;
  let count = 0;
  for (let y = vertical.from; y <= vertical.to; y++) for (let x = horizontal.from; x <= horizontal.to; x++) {
    if (owner[(y + minY) * width + x + minX] === seed) count++;
  }
  return { minX: minX + horizontal.from, minY: minY + vertical.from, maxX: minX + horizontal.to, maxY: minY + vertical.to, count };
}

export { labelMask };
