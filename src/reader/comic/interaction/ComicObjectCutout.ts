import type { ComicVisualContainer } from "./ComicContainerDetector";
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
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      const px = x + col, py = y + row;
      if (!container) { alpha[row * width + col] = 255; continue; }
      if (includes(container, px, py)) { alpha[row * width + col] = 255; continue; }
      if (neighbours.some(item => includes(item, px, py))) continue;
      // Include only the immediate drawn edge, without rounding/reconstructing the shape.
      let edge = false;
      for (let dy = -pad; dy <= pad && !edge; dy++) for (let dx = -pad; dx <= pad; dx++) {
        if (dx * dx + dy * dy <= pad * pad && includes(container, px + dx, py + dy)) { edge = true; break; }
      }
      if (edge) alpha[row * width + col] = 255;
    }
    // A colour component may open into the page through lettering near its edge.
    // Never publish a mask which visibly cuts that lettering. Keep the original crop
    // explicitly as a review fallback instead of inventing/painting missing pixels.
    // On captions the text detector can miss an entire line at the box edge. Check
    // the full detected caption body, not only the already recognized line bounds.
    const protectedInk = container?.shape === "rectangle" ? container.bbox : container?.ink;
    const clippedInk = container && protectedInk ? comicMaskCutsInk(pixels, alpha, {
      x0: protectedInk.x0 - x, y0: protectedInk.y0 - y,
      x1: protectedInk.x1 - x, y1: protectedInk.y1 - y,
    }, container.textColor) : false;
    const fallback = !container || clippedInk;
    if (fallback) alpha.fill(255);
    const assetPath = `interaction/assets/${region.id}.png`, maskPath = `interaction/assets/${region.id}-mask.png`;
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

/** Conservative safety check against the source image, not against OCR characters. */
export function comicMaskCutsInk(image: ImageData, alpha: Uint8Array,
  ink: { x0: number; y0: number; x1: number; y1: number }, colour: string): boolean {
  if (!/^#[0-9a-f]{6}$/i.test(colour)) return false;
  const rgb = Number.parseInt(colour.slice(1), 16), r = rgb >> 16, g = (rgb >> 8) & 255, b = rgb & 255;
  let total = 0, missing = 0;
  for (let y = Math.max(0, Math.floor(ink.y0)); y < Math.min(image.height, ink.y1); y++) {
    for (let x = Math.max(0, Math.floor(ink.x0)); x < Math.min(image.width, ink.x1); x++) {
      const i = y * image.width + x, p = i * 4;
      if (Math.abs(image.data[p]! - r) > 32 || Math.abs(image.data[p + 1]! - g) > 32 || Math.abs(image.data[p + 2]! - b) > 32) continue;
      total++; if (!alpha[i]) missing++;
    }
  }
  return missing > 8 && missing > total * .01;
}

async function encode(canvas: HTMLCanvasElement, path: string): Promise<ComicPageAsset> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Object asset encoding failed")), "image/png"));
  return { path, data: new Uint8Array(await blob.arrayBuffer()), mimeType: "image/png", width: canvas.width, height: canvas.height };
}
