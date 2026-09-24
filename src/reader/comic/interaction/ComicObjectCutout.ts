import type { ComicStencil, ComicVisualContainer } from "./ComicContainerDetector";
import { dilateMaskSquare, type ComicMask } from "./ComicShapeMask";
import type { ComicPageAsset, ComicTextRegion } from "./ComicInteractionTypes";
import { comicRegionBounds } from "./ComicRegionBounds";

/** Copy RGB verbatim; only alpha is changed. Interior drawings/lettering are never
 * classified as background. A mask describes the whole container, including its holes. */
export function comicMaskedPixels(source: ImageData, alpha: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  if (alpha.length !== source.width * source.height) throw new Error("Invalid object mask dimensions");
  const output = new Uint8ClampedArray(source.data);
  for (let i = 0; i < alpha.length; i++) output[i * 4 + 3] = Math.round(source.data[i * 4 + 3]! * alpha[i]! / 255);
  return output;
}

/** Assets are produced during conversion from the full source render, never the display
 * canvas. Connected-component silhouettes keep enclosed lettering and icons intact.
 * The detector's separate stencils partition touching containers before extraction. */
export async function comicCreateCutouts(canvas: HTMLCanvasElement, regions: ComicTextRegion[],
  containers: readonly ComicVisualContainer[]): Promise<ComicPageAsset[]> {
  const source = canvas.getContext("2d", { willReadFrequently: true })!;
  const assets: ComicPageAsset[] = [];
  for (const region of regions) {
    const visual = comicRegionBounds(region).visual;
    const candidates = containers.map(container => ({ container, error:
      Math.abs(container.bbox.x0 / canvas.width - visual.x) + Math.abs(container.bbox.y0 / canvas.height - visual.y)
      + Math.abs((container.bbox.x1 - container.bbox.x0) / canvas.width - visual.width)
      + Math.abs((container.bbox.y1 - container.bbox.y0) / canvas.height - visual.height) }));
    const match = candidates.sort((a, b) => a.error - b.error)[0];
    const container = match && match.error < .015 ? match.container : undefined;
    // A narrow border allowance covers ink excluded by the fill detector. It cannot
    // grow unbounded into the artwork or cross into another container's interior.
    const pad = container ? container.stencil.step * 2 : 0;
    const art = container?.artBbox ?? container?.bbox;
    const x = Math.max(0, Math.floor(art?.x0 ?? visual.x * canvas.width) - pad);
    const y = Math.max(0, Math.floor(art?.y0 ?? visual.y * canvas.height) - pad);
    const right = Math.min(canvas.width, Math.ceil(art?.x1 ?? (visual.x + visual.width) * canvas.width) + pad);
    const bottom = Math.min(canvas.height, Math.ceil(art?.y1 ?? (visual.y + visual.height) * canvas.height) + pad);
    const width = right - x, height = bottom - y;
    const pixels = source.getImageData(x, y, width, height);
    const alpha = new Uint8Array(width * height);
    const includes = (item: ComicVisualContainer, px: number, py: number): boolean => {
      const s = item.artStencil ?? item.stencil, cx = Math.floor((px - s.x) / s.step), cy = Math.floor((py - s.y) / s.step);
      return cx >= 0 && cy >= 0 && cx < s.width && cy < s.height && s.data[cy * s.width + cx] === 1;
    };
    const neighbours = containers.filter(item => item !== container && item.bbox.x0 < right && item.bbox.x1 > x
      && item.bbox.y0 < bottom && item.bbox.y1 > y);
    // The drawn edge, as a stencil rather than as a search. Asking "is any pixel within
    // `pad` of this container" once per pixel means scanning a disc of eighty-one lookups
    // per pixel, which on a phone is most of a minute for a single page. The stencil is
    // grown once instead and the question becomes one lookup. The grown shape covers every
    // pixel the disc did and, at the corners, at most one cell more - the allowance only
    // ever reaches further into the container's own drawn edge, never less far.
    const grown = container ? comicGrowStencil(container.artStencil ?? container.stencil, Math.ceil(pad / container.stencil.step)) : undefined;
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      const px = x + col, py = y + row;
      if (!container) { alpha[row * width + col] = 255; continue; }
      if (includes(container, px, py)) { alpha[row * width + col] = 255; continue; }
      if (neighbours.some(item => includes(item, px, py))) continue;
      if (grown && includesStencil(grown, px, py)) alpha[row * width + col] = 255;
    }
    // A colour component may open into the page through lettering near its edge.
    // Never publish a mask which visibly cuts that lettering. Keep the original crop
    // explicitly as a review fallback instead of inventing/painting missing pixels.
    // On captions the text detector can miss an entire line at the box edge. Check
    // the full detected caption body, not only the already recognized line bounds.
    const protectedInk = container?.shape === "rectangle" ? container.bbox : container?.ink;
    // How far from the container a dark pixel may sit and still be its own lettering.
    const owned = container ? comicGrowStencil(container.artStencil ?? container.stencil,
      Math.ceil(pad / container.stencil.step) + 6) : undefined;
    const cutsInk = (): boolean => container !== undefined && protectedInk !== undefined && comicMaskCutsInk(pixels, alpha, {
      x0: protectedInk.x0 - x, y0: protectedInk.y0 - y,
      x1: protectedInk.x1 - x, y1: protectedInk.y1 - y,
    }, container.textColor, owned ? (px, py) => includesStencil(owned, x + px, y + py) : undefined);
    // A mask that clips a letter used to be thrown away whole, and what the reader then
    // saw when they touched the balloon was a rectangle of page with the balloon somewhere
    // inside it. The mask is loosened instead, a ring at a time, until it stops cutting -
    // the balloon keeps its shape and only gains a little of its own drawn edge. The bare
    // rectangle stays as the last resort, and says so.
    let clippedInk = cutsInk();
    if (clippedInk && container) {
      const source = container.artStencil ?? container.stencil;
      for (const reach of [2, 4, 7, 11]) {
        const loosened = comicGrowStencil(source, Math.ceil(pad / container.stencil.step) + reach);
        for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
          if (!alpha[row * width + col] && includesStencil(loosened, x + col, y + row)) alpha[row * width + col] = 255;
        }
        clippedInk = cutsInk();
        if (!clippedInk) break;
      }
    }
    const fallback = !container || clippedInk;
    if (fallback) alpha.fill(255);
    const assetPath = `interaction/assets/${region.id}.webp`, maskPath = `interaction/assets/${region.id}-mask.webp`;
    const output = document.createElement("canvas"); output.width = width; output.height = height;
    const context = output.getContext("2d")!;
    context.putImageData(new ImageData(comicMaskedPixels(pixels, alpha), width, height), 0, 0);
    assets.push(await encode(output, assetPath));
    const mask = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < alpha.length; i++) { mask[i * 4] = mask[i * 4 + 1] = mask[i * 4 + 2] = 255; mask[i * 4 + 3] = alpha[i]!; }
    context.putImageData(new ImageData(mask, width, height), 0, 0);
    assets.push(await encode(output, maskPath)); output.width = output.height = 0;
    region.assetPath = assetPath; region.maskPath = maskPath;
    region.assetWidth = width; region.assetHeight = height;
    region.visualBounds = { x: x / canvas.width, y: y / canvas.height, width: width / canvas.width, height: height / canvas.height };
    region.hitBounds = { ...region.visualBounds }; Object.assign(region, region.hitBounds);
    region.segmentationMethod = fallback ? "original-crop-fallback" : "component-mask";
    // Shape confidence is heuristic, not a calibrated probability of pixel accuracy.
    region.segmentationConfidence = container && !fallback ? Math.min(.85, container.styleConfidence) : 0;
    region.segmentationNeedsReview = fallback || region.segmentationConfidence < .8;
    if (clippedInk) region.reviewReasons = [...new Set([...(region.reviewReasons ?? []), "mask-clips-original-ink"] )];
    region.needsReview = region.recognitionStatus !== "recognized";
  }
  return assets;
}

/** Whether a stencil covers a page pixel. */
function includesStencil(stencil: ComicStencil, px: number, py: number): boolean {
  const cx = Math.floor((px - stencil.x) / stencil.step), cy = Math.floor((py - stencil.y) / stencil.step);
  return cx >= 0 && cy >= 0 && cx < stencil.width && cy < stencil.height && stencil.data[cy * stencil.width + cx] === 1;
}

/** The same silhouette, widened by `reach` cells in every direction. */
export function comicGrowStencil(stencil: ComicStencil, reach: number): ComicStencil {
  let mask: ComicMask = { width: stencil.width, height: stencil.height, data: stencil.data };
  for (let step = 0; step < Math.max(0, reach); step++) mask = dilateMaskSquare(mask);
  return { ...stencil, data: mask.data };
}

/** Conservative safety check against the source image, not against OCR characters.
 *
 *  Only ink the container could plausibly own counts. A balloon of two or three lobes has
 *  a wide block of lettering, and the corners between its lobes are page - often dark page,
 *  the colour of lettering. Counting those as clipped letters condemned every composite
 *  balloon to be shown as a bare rectangle of scenery. `owned` marks where the container
 *  itself reaches; anything darker than the page beyond that is the drawing, not the words. */
export function comicMaskCutsInk(image: ImageData, alpha: Uint8Array,
  ink: { x0: number; y0: number; x1: number; y1: number }, colour: string,
  owned?: (x: number, y: number) => boolean): boolean {
  if (!/^#[0-9a-f]{6}$/i.test(colour)) return false;
  const rgb = Number.parseInt(colour.slice(1), 16), r = rgb >> 16, g = (rgb >> 8) & 255, b = rgb & 255;
  let total = 0, missing = 0;
  for (let y = Math.max(0, Math.floor(ink.y0)); y < Math.min(image.height, ink.y1); y++) {
    for (let x = Math.max(0, Math.floor(ink.x0)); x < Math.min(image.width, ink.x1); x++) {
      const i = y * image.width + x, p = i * 4;
      if (Math.abs(image.data[p]! - r) > 32 || Math.abs(image.data[p + 1]! - g) > 32 || Math.abs(image.data[p + 2]! - b) > 32) continue;
      if (!alpha[i] && owned && !owned(x, y)) continue;
      total++; if (!alpha[i]) missing++;
    }
  }
  return missing > 8 && missing > total * .01;
}

/** WebP, like the page images beside them. Alpha is stored losslessly either way, so the
 *  cut edge of a balloon stays exactly where the mask put it; the colours inside get the
 *  same treatment the page itself already gets. Measured on the phone, encoding two PNGs
 *  per region was over a minute a page - most of what was left once recognition was in
 *  hand. A browser that cannot write WebP falls back to PNG on its own, and the stored
 *  type follows whatever came back. */
async function encode(canvas: HTMLCanvasElement, path: string): Promise<ComicPageAsset> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Object asset encoding failed")), "image/webp", .95));
  const mimeType = blob.type === "image/webp" ? "image/webp" : "image/png";
  return { path, data: new Uint8Array(await blob.arrayBuffer()), mimeType, width: canvas.width, height: canvas.height };
}
