import { detectComicContainers } from "./ComicContainerDetector";
import { comicReadingOrder, type ComicReadingDirection } from "./ComicReadingOrder";
import { comicPrepareCrop } from "./ComicRegionCrop";
import type { ComicPageAsset, ComicTextRegion } from "./ComicInteractionTypes";
import { comicCreateCutouts } from "./ComicObjectCutout";
import type { ComicRegionOcr } from "./ComicRegionOcr";
import type { ComicStencil } from "./ComicContainerDetector";

/** Everything one rendered page goes through: find the containers in colour, then read
 *  each of them from a crop prepared for its own background.
 *
 *  The rendered canvas is only ever read from here - the packaged page image keeps the
 *  artist's colours exactly as they were. */
export async function comicReadPageRegions(canvas: HTMLCanvasElement, pageIndex: number, ocr: ComicRegionOcr,
  signal?: AbortSignal, direction: ComicReadingDirection = "ltr", assets?: ComicPageAsset[]): Promise<ComicTextRegion[]> {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas indisponivel para leitura de pagina de HQ.");
  const page = context.getImageData(0, 0, canvas.width, canvas.height);
  const containers = detectComicContainers(page);
  signal?.throwIfAborted();
  const crop = document.createElement("canvas");
  try {
    const regions = await ocr.recognize(canvas, canvas.width, canvas.height, pageIndex, signal, containers, ({ bounds, plan, stencil, background }) => {
      const width = Math.max(1, bounds.x1 - bounds.x0), height = Math.max(1, bounds.y1 - bounds.y0);
      const source = new ImageData(width, height);
      for (let y = 0; y < height; y++) {
        const from = ((bounds.y0 + y) * page.width + bounds.x0) * 4;
        source.data.set(page.data.subarray(from, from + width * 4), y * width * 4);
      }
      if (stencil) paintOutside(source, bounds, stencil, background);
      const prepared = comicPrepareCrop(source, plan);
      crop.width = prepared.width; crop.height = prepared.height;
      crop.getContext("2d")!.putImageData(prepared, 0, 0);
      return crop;
    });
    if (assets) assets.push(...await comicCreateCutouts(canvas, regions, containers));
    signal?.throwIfAborted();
    // Reading order is the last word on a page, once every region on it is known.
    return comicReadingOrder(regions, direction);
  } finally { crop.width = crop.height = 0; }
}

/** Paints everything outside the container's silhouette with the container's own colour,
 *  so recognition sees one balloon and nothing of what it was drawn against. */
function paintOutside(crop: ImageData, bounds: { x0: number; y0: number }, stencil: ComicStencil, background?: string): void {
  const colour = parse(background) ?? { r: 255, g: 255, b: 255 };
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
    const cellX = Math.floor((bounds.x0 + x - stencil.x) / stencil.step);
    const cellY = Math.floor((bounds.y0 + y - stencil.y) / stencil.step);
    const inside = cellX >= 0 && cellY >= 0 && cellX < stencil.width && cellY < stencil.height
      && stencil.data[cellY * stencil.width + cellX] === 1;
    if (inside) continue;
    const offset = (y * crop.width + x) * 4;
    crop.data[offset] = colour.r; crop.data[offset + 1] = colour.g; crop.data[offset + 2] = colour.b; crop.data[offset + 3] = 255;
  }
}

function parse(colour?: string): { r: number; g: number; b: number } | null {
  if (!colour || !/^#[0-9a-f]{6}$/i.test(colour)) return null;
  const value = Number.parseInt(colour.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}
