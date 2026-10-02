import type { Bbox } from "tesseract.js";
import type { ComicStencil, ComicVisualContainer } from "./ComicContainerDetector";
import { dilateMaskSquare, sealComicArtMask, type ComicMask } from "./ComicShapeMask";
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

/** How far a crop may stretch past its own art in one direction before a real neighbour,
 *  sharing enough of the other axis to actually be in the way, is reached. Half of
 *  whatever page is actually free in that direction, capped by a comfortable default -
 *  generous next to open page, next to nothing once a neighbour is close. `exclude` is the
 *  container this crop is itself for, if it has one - never its own neighbour. */
function comicCropPadding(art: Bbox, siblings: readonly ComicVisualContainer[], exclude: ComicVisualContainer | undefined,
  direction: "left" | "right" | "top" | "bottom", ceiling = Number.POSITIVE_INFINITY): number {
  const comfortable = Math.min(ceiling, Math.max(6, Math.min(art.x1 - art.x0, art.y1 - art.y0) * .08));
  let nearest = Number.POSITIVE_INFINITY;
  for (const other of siblings) {
    if (other === exclude) continue;
    const box = other.artBbox ?? other.bbox;
    if (direction === "left" || direction === "right") {
      if (Math.min(art.y1, box.y1) - Math.max(art.y0, box.y0) <= 0) continue; // Never shares this row.
      const gap = direction === "left" ? art.x0 - box.x1 : box.x0 - art.x1;
      if (gap >= 0) nearest = Math.min(nearest, gap);
    } else {
      if (Math.min(art.x1, box.x1) - Math.max(art.x0, box.x0) <= 0) continue; // Never shares this column.
      const gap = direction === "top" ? art.y0 - box.y1 : box.y0 - art.y1;
      if (gap >= 0) nearest = Math.min(nearest, gap);
    }
  }
  if (!Number.isFinite(nearest)) return comfortable;
  // Reach partway into the real gap, never touching - let alone crossing into - whatever
  // is sitting there, however little comfortable padding would have asked for.
  return Math.max(0, Math.min(comfortable, nearest / 2));
}

/** The rectangle one region's popup is cropped from: its own art, widened by padding that
 *  backs off on whichever side a real neighbour is actually close enough to reach - decided
 *  once, from the page's own geometry, never redrawn for the reader to see.
 *
 *  `art` is the container's own bounds when a container was found for this region, but a
 *  region with no matching container - OCR text with nothing the colour detector ever
 *  enclosed - still gets padding around its own recognized bounds too, rather than the
 *  bare, pixel-tight rectangle a raw OCR box is. That padding is capped much tighter for an
 *  orphan than for a real container, through `ceiling`: a container's own silhouette is
 *  trusted to say where its art actually ends, but an orphan line has no such shape behind
 *  it, only its neighbours' positions - the same balloon's own next line down is, to this
 *  function, just another nearby box. Generous padding there does not add a margin, it
 *  reaches into that next line and crops half of it: legible words above and below the one
 *  line this region actually recognized, each sliced through its own letters. Kept to a
 *  sliver instead, a miss stays a clean, honestly tight crop of the words that were
 *  actually read - never somebody else's line shown broken. */
export function comicAdaptiveCropBounds(art: Bbox, siblings: readonly ComicVisualContainer[], canvasWidth: number, canvasHeight: number,
  exclude?: ComicVisualContainer, ceiling = Number.POSITIVE_INFINITY): Bbox {
  const x0 = Math.max(0, Math.floor(art.x0 - comicCropPadding(art, siblings, exclude, "left", ceiling)));
  const y0 = Math.max(0, Math.floor(art.y0 - comicCropPadding(art, siblings, exclude, "top", ceiling)));
  const x1 = Math.min(canvasWidth, Math.ceil(art.x1 + comicCropPadding(art, siblings, exclude, "right", ceiling)));
  const y1 = Math.min(canvasHeight, Math.ceil(art.y1 + comicCropPadding(art, siblings, exclude, "bottom", ceiling)));
  return { x0, y0, x1: Math.max(x1, x0 + 1), y1: Math.max(y1, y0 + 1) };
}

/** Assets are produced during conversion from the full source render, never the display
 *  canvas - and always as one continuous rectangle of it, at full opacity.
 *
 *  A per-pixel silhouette used to be cut from this same rectangle, to crop a balloon to its
 *  own curved outline rather than hand back its whole bounding box. That shape never
 *  perfectly matches what the flood fill actually found - a concave notch between two
 *  lobes, a highlight the fill's own tolerance did not cross - and every pixel the shape
 *  left out of a word's own territory came back as a hole in the popup: transparent, not
 *  missing art, but exactly as unreadable. A continuous crop cannot have one: there is
 *  nothing inside the rectangle for a silhouette to carve out. The trade is a corner of
 *  neighbouring artwork sometimes showing at the edge of a round balloon's popup, which
 *  `comicAdaptiveCropBounds` already keeps small by backing off whenever a real neighbour
 *  is close - never a letter, a tail or a word missing from the middle of a sentence. */
export async function comicCreateCutouts(canvas: HTMLCanvasElement, regions: ComicTextRegion[],
  containers: readonly ComicVisualContainer[]): Promise<ComicPageAsset[]> {
  const source = canvas.getContext("2d", { willReadFrequently: true })!;
  const assets: ComicPageAsset[] = [];
  for (const region of regions) {
    const bounds = comicRegionBounds(region);
    const visual = bounds.visual;
    const candidates = containers.map(container => ({ container, error:
      Math.abs(container.bbox.x0 / canvas.width - visual.x) + Math.abs(container.bbox.y0 / canvas.height - visual.y)
      + Math.abs((container.bbox.x1 - container.bbox.x0) / canvas.width - visual.width)
      + Math.abs((container.bbox.y1 - container.bbox.y0) / canvas.height - visual.height) }));
    const match = candidates.sort((a, b) => a.error - b.error)[0];
    const container = match && match.error < .015 ? match.container : undefined;
    // A container's own bounds when one was found for this region. An orphan line uses its
    // own recognized glyphs instead of `visual` - the recognition step pads that one by a
    // few pixels of its own, on purpose, to give itself margin to read the word by; this
    // crop needs the tighter box those glyphs actually measured, not the margin around it,
    // since a line with no detected shape behind it is the one case a few pixels in the
    // wrong direction reaches the very next line of the same never-found balloon.
    const text = bounds.text;
    const art: Bbox = container?.artBbox ?? container?.bbox ?? {
      x0: text.x * canvas.width, y0: text.y * canvas.height,
      x1: (text.x + text.width) * canvas.width, y1: (text.y + text.height) * canvas.height,
    };
    // An orphan line gets only the barest antialiasing margin from this step - a balloon
    // the colour detector never found at all can pack its own lines closely enough that
    // real padding here, measured from nothing but this one line's own small size, reaches
    // the next line up or down and crops it in half.
    const cropBounds = comicAdaptiveCropBounds(art, containers, canvas.width, canvas.height, container, container ? Number.POSITIVE_INFINITY : 2);
    const x = cropBounds.x0, y = cropBounds.y0, width = Math.max(1, cropBounds.x1 - x), height = Math.max(1, cropBounds.y1 - y);
    const pixels = source.getImageData(x, y, width, height);
    const assetPath = `interaction/assets/${region.id}.webp`, maskPath = `interaction/assets/${region.id}-mask.webp`;
    const output = document.createElement("canvas"); output.width = width; output.height = height;
    const context = output.getContext("2d")!;
    context.putImageData(pixels, 0, 0);
    assets.push(await encode(output, assetPath));
    // A fully opaque mask, kept only so the field exists for whatever still reads it - the
    // crop itself is always the whole continuous rectangle now, nothing within it unseen.
    const mask = new Uint8ClampedArray(width * height * 4).fill(255);
    context.putImageData(new ImageData(mask, width, height), 0, 0);
    assets.push(await encode(output, maskPath)); output.width = output.height = 0;
    region.assetPath = assetPath; region.maskPath = maskPath;
    region.assetWidth = width; region.assetHeight = height;
    region.visualBounds = { x: x / canvas.width, y: y / canvas.height, width: width / canvas.width, height: height / canvas.height };
    region.hitBounds = { ...region.visualBounds }; Object.assign(region, region.hitBounds);
    region.segmentationMethod = "original-crop-fallback";
    if (region.bubbleGroup) {
      region.bubbleGroup.unionBounds = { ...region.visualBounds };
      region.bubbleGroup.unionMaskPath = maskPath;
    }
    region.segmentationConfidence = container ? Math.min(.85, container.styleConfidence) : 0;
    region.segmentationNeedsReview = region.segmentationConfidence < .8;
    region.needsReview = region.recognitionStatus !== "recognized";
  }
  return assets;
}

/** The same silhouette, widened by `reach` cells in every direction. Kept for whatever
 *  still reads a container's own stencil for shape, not for cropping - container detection
 *  and the hint animator still work from pixel silhouettes; only the final popup no longer
 *  does. */
export function comicGrowStencil(stencil: ComicStencil, reach: number): ComicStencil {
  let mask: ComicMask = sealComicArtMask({ width: stencil.width, height: stencil.height, data: stencil.data }, 0);
  for (let step = 0; step < Math.max(0, reach); step++) mask = dilateMaskSquare(mask);
  return { ...stencil, data: mask.data };
}

/** Conservative safety check against the source image, not against OCR characters. Kept
 *  for the components still reading it; the popup crop itself no longer needs it, since a
 *  continuous rectangle has nothing inside it a mask could clip. */
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
