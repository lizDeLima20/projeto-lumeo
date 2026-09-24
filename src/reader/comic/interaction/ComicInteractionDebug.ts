import type { ComicTextRegion } from "./ComicInteractionTypes";
import type { ComicRect } from "../ComicLayout";
import { comicRegionBounds } from "./ComicRegionBounds";

/** The colours of the three rectangles, so a page can be audited at a glance: what may be
 *  touched, what the balloon is made of, and where the words were found. */
export const COMIC_DEBUG_COLOURS = { hit: "#2f6fed", visual: "#008c69", text: "#de651a" } as const;

/** Opt-in drawing only. No event handlers, hit targets or expanded balloons.
 *
 *  Meant for one question as much as for the other: is what we read correct, and is there
 *  any visible text on this page with no region at all? */
export function drawComicInteractionDebug(context: CanvasRenderingContext2D, regions: readonly ComicTextRegion[], art: ComicRect, enabled = false): void {
  if (!enabled) return;
  context.save(); context.font = "12px sans-serif";
  for (const region of regions) {
    const bounds = comicRegionBounds(region);
    for (const [key, rect] of [["hit", bounds.hit], ["visual", bounds.visual], ["text", bounds.text]] as const) {
      context.strokeStyle = COMIC_DEBUG_COLOURS[key];
      context.lineWidth = key === "visual" ? 2 : 1;
      context.setLineDash(key === "text" ? [4, 3] : []);
      context.strokeRect(art.x + rect.x * art.width, art.y + rect.y * art.height, rect.width * art.width, rect.height * art.height);
    }
    context.setLineDash([]);
    const x = art.x + bounds.hit.x * art.width, y = art.y + bounds.hit.y * art.height;
    const review = region.recognitionStatus === "needs-review";
    const label = `${region.id} ${Math.round((region.ocrConfidence ?? 0) * 100)}%${review ? " ⚑" : ""}`;
    const labelY = Math.max(art.y + 14, y);
    context.fillStyle = review ? "#ffe9d6" : "#fff";
    context.fillRect(x, labelY - 13, context.measureText(label).width + 4, 15);
    context.fillStyle = "#111"; context.fillText(label, x + 2, labelY - 1);
  }
  context.restore();
}
