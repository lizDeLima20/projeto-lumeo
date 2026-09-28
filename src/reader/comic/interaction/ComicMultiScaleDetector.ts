import { detectComicContainers, type ComicVisualContainer } from "./ComicContainerDetector";
import { comicBoundsIou } from "./ComicRegionDedup";

/** Scan the entire page on three sampling grids, sequentially with a bounded fine grid.
 * No edge/centre preference, remote inference or simultaneous full-page allocations. */
export async function detectComicContainersMultiScale(image: ImageData, signal?: AbortSignal): Promise<ComicVisualContainer[]> {
  const pixels = image.width * image.height;
  const baseline = Math.max(2, Math.ceil(Math.sqrt(pixels / 1_200_000)));
  const fine = Math.max(1, Math.ceil(Math.sqrt(pixels / 2_000_000)));
  const steps = [...new Set([baseline, baseline + 1, fine])];
  const selected: ComicVisualContainer[] = [];
  const bounds = (c: ComicVisualContainer) => ({ x:c.bbox.x0,y:c.bbox.y0,width:c.bbox.x1-c.bbox.x0,height:c.bbox.y1-c.bbox.y0 });
  for (const step of steps) {
    signal?.throwIfAborted();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    for (const candidate of detectComicContainers(image, { step })) {
      const b = bounds(candidate);
      const duplicate = selected.findIndex(other => {
        const a = bounds(other), area = a.width*a.height, nextArea=b.width*b.height;
        return Math.min(area,nextArea)/Math.max(1,area,nextArea)>=.65 && comicBoundsIou(a,b)>=.75;
      });
      if (duplicate < 0) selected.push(candidate);
      // Better sampling of the SAME container replaces only its own candidate.
      else if (candidate.stencil.step < selected[duplicate]!.stencil.step) selected[duplicate] = candidate;
    }
  }
  signal?.throwIfAborted();
  return selected.sort((a,b)=>a.bbox.y0-b.bbox.y0 || a.bbox.x0-b.bbox.x0);
}

/** Encoded CBR/CBZ art can be larger than the OCR canvas. Never mix coordinate spaces. */
export function comicEncodedMatchesCanvas(encoded: {width?:number;height?:number} | undefined, width:number, height:number): boolean {
  return encoded !== undefined && encoded.width === width && encoded.height === height;
}
