import type { ComicRect } from "../ComicLayout";
import { comicBubbleTarget, comicBubbleText, type ComicBubbleTarget } from "./ComicBubbleLayout";
import type { ComicTextRegion } from "./ComicInteractionTypes";
import { comicArtworkCanvas, type ComicOriginalArt } from "./ComicObjectArtwork";
import { comicAnalyzeBalloonQuality } from "./ComicBalloonQuality";
import { comicEnhanceBalloonImage, comicPlanBalloonEnhancement } from "./ComicBalloonEnhancer";

export const COMIC_BUBBLE_MOTION = { openMs: 340, closeMs: 240 } as const;
interface Shown { region: ComicTextRegion; source: ComicRect; target: ComicBubbleTarget; element: HTMLElement }

/** The one canvas the reader actually sees, already decided. There is no second, exposed
 *  version: a reader taps a balloon and gets the best representation this pass could make
 *  of it, never a choice to weigh. */
interface ComicBubbleArtwork { canvas: HTMLCanvasElement; fallback: boolean; }

/** A balloon is reprocessed once per size it is ever shown at in this session, not once
 *  per tap - reopening the same balloon at the same size is instant. Bounded well under
 *  what the decoded-bitmap cache it draws from already allows, since each entry here is a
 *  full display-resolution canvas rather than a compressed original. */
const ARTWORK_CACHE_LIMIT = 8;

/** The least improvement, read on the same 0..1 scale `comicAnalyzeBalloonQuality` uses,
 *  that counts as the enhanced pass actually reading better rather than merely different -
 *  noise and rounding alone can nudge these metrics by a point or two either way. */
const MEANINGFUL_GAIN = .03;

/** The original asset upscaled to its display size, with the page's one adaptive
 *  enhancement pass measured against it on the same terms a reader judges legibility by -
 *  contrast and sharpness - and kept only when it actually reads better. Built from the
 *  same full-resolution draw either way, never from a reduced screen capture. Any failure
 *  in analysis or enhancement falls back to the plain upscaled original: a balloon that
 *  cannot be improved must still open, and silently, never asking the reader to judge it. */
function comicPrepareBubbleArtwork(region: ComicTextRegion, width: number, height: number, art: ComicOriginalArt): ComicBubbleArtwork {
  const original = comicArtworkCanvas(art, { width, height });
  const fallback = Boolean(art.fallback);
  try {
    const context = original.getContext("2d", { willReadFrequently: true });
    if (!context) return { canvas: original, fallback };
    const source = context.getImageData(0, 0, original.width, original.height);
    const before = comicAnalyzeBalloonQuality(source);
    const plan = comicPlanBalloonEnhancement(before, region.ocrConfidence);
    if (plan.sharpen + plan.denoise + plan.contrast + plan.whiten <= .05) return { canvas: original, fallback };
    const enhancedData = comicEnhanceBalloonImage(context.getImageData(0, 0, original.width, original.height), plan);
    const after = comicAnalyzeBalloonQuality(enhancedData);
    // The same test a reader would apply, not the size of the plan that produced it: a
    // pass that asked for a lot but left contrast and sharpness no better than the
    // original - a balloon that was already about as good as this pipeline gets - loses
    // to the plain upscale rather than being shown just because work was done.
    if (after.contrast - before.contrast < MEANINGFUL_GAIN && after.sharpness - before.sharpness < MEANINGFUL_GAIN) return { canvas: original, fallback };
    const enhanced = document.createElement("canvas");
    enhanced.width = original.width; enhanced.height = original.height;
    enhanced.getContext("2d")!.putImageData(enhancedData, 0, 0);
    return { canvas: enhanced, fallback };
  } catch { return { canvas: original, fallback }; }
}

/** Original artwork only. OCR is accessibility metadata, never visible lettering. */
export class ComicBubbleView {
  private shown: Shown | null = null;
  private request = 0;
  private openedAtValue = 0;
  private readonly artworkCache = new Map<string, ComicBubbleArtwork>();
  public constructor(private readonly layer: HTMLElement, private readonly options: {
    compact: () => boolean;
    art?: (region: ComicTextRegion) => ComicOriginalArt | null | Promise<ComicOriginalArt | null>;
    /** The other balloons of the page on screen, so the enlarged one can avoid covering
     *  them; the region being opened is never among them. */
    obstacles?: (region: ComicTextRegion) => readonly ComicRect[];
    onClose?: () => void;
  }) {}
  public get activeRegion(): ComicTextRegion | null { return this.shown?.region ?? null; }
  /** When the balloon on screen finished opening, so a late click from the same tap is
   *  not mistaken for the reader asking for something else. */
  public get openedAt(): number { return this.openedAtValue; }
  public get isOpen(): boolean { return this.shown !== null; }
  public async open(region: ComicTextRegion, source: ComicRect): Promise<void> {
    if (this.shown?.region.id === region.id) return;
    const request = ++this.request;
    let art: ComicOriginalArt | null;
    try { art = await this.options.art?.(region) ?? null; } catch { return; }
    if (!art || request !== this.request) return;
    const viewport = { width: this.layer.clientWidth || window.innerWidth, height: this.layer.clientHeight || window.innerHeight };
    const layerTop = this.layer.getBoundingClientRect().top;
    const safeTop = Math.max(0, ...Array.from(this.layer.closest(".comic-reader")?.querySelectorAll<HTMLElement>(".comic-fab") ?? [])
      .filter(control => control.getBoundingClientRect().height > 0)
      .map(control => control.getBoundingClientRect().bottom - layerTop + 6));
    const target = comicBubbleTarget({ source, viewport, compact: this.options.compact(), region,
      obstacles: this.options.obstacles?.(region), safeTop });
    const artwork = this.artworkFor(region, target.width, target.height, art);
    const element = ComicBubbleView.build(region, target.width, target.height, artwork);
    Object.assign(element.style, { left: `${target.x}px`, top: `${target.y}px`, width: `${target.width}px`, height: `${target.height}px` });
    this.layer.append(element);
    const previous = this.shown; this.shown = { region, source, target, element };
    this.openedAtValue = typeof performance === "object" ? performance.now() : Date.now();
    if (previous) this.retire(previous, true);
    element.style.pointerEvents = "none";
    const opening = element.animate([
      { transform: ComicBubbleView.transformFrom(source, target) }, { transform: "translate(0, 0) scale(1)" },
    ], { duration: ComicBubbleView.reduced ? 1 : COMIC_BUBBLE_MOTION.openMs, easing: "cubic-bezier(.2,.8,.25,1)", fill: "backwards" });
    const accept = (): void => { element.style.pointerEvents = "auto"; };
    opening.addEventListener("finish", accept, { once: true }); opening.addEventListener("cancel", accept, { once: true });
    element.focus({ preventScroll: true });
  }
  public close(): void {
    this.request++; const shown = this.shown; if (!shown) return;
    this.shown = null; this.retire(shown, false); this.options.onClose?.();
  }
  public closeNow(): void {
    this.request++;
    this.layer.querySelectorAll<HTMLElement>(".comic-bubble").forEach(element => element.remove());
    const was = this.shown !== null; this.shown = null; if (was) this.options.onClose?.();
  }
  public destroy(): void { this.closeNow(); this.artworkCache.clear(); }

  /** The balloon's artwork pair for this exact display size, built once and kept for the
   *  rest of the session - reopening the same balloon, or one at the same size, never
   *  repeats the analysis or the enhancement pass. */
  private artworkFor(region: ComicTextRegion, width: number, height: number, art: ComicOriginalArt): ComicBubbleArtwork {
    const key = `${region.id}:${Math.round(width)}x${Math.round(height)}:${art.fallback ? "f" : "o"}`;
    const cached = this.artworkCache.get(key);
    if (cached) return cached;
    const artwork = comicPrepareBubbleArtwork(region, width, height, art);
    this.artworkCache.set(key, artwork);
    if (this.artworkCache.size > ARTWORK_CACHE_LIMIT) this.artworkCache.delete(this.artworkCache.keys().next().value!);
    return artwork;
  }

  public static build(region: ComicTextRegion, width: number, height: number, artwork: ComicBubbleArtwork): HTMLElement {
    const element = document.createElement("div"); element.className = "comic-bubble"; element.tabIndex = -1;
    element.setAttribute("role", "dialog"); element.setAttribute("aria-label", comicBubbleText(region.text).slice(0, 200));
    element.dataset.regionId = region.id;
    element.dataset.visual = artwork.fallback ? "original-crop-fallback" : "original-object";
    element.dataset.review = region.recognitionStatus ?? "needs-review";
    const canvas = document.createElement("canvas"); canvas.className = "comic-bubble__art"; canvas.setAttribute("aria-hidden", "true");
    canvas.width = artwork.canvas.width; canvas.height = artwork.canvas.height;
    canvas.getContext("2d")!.drawImage(artwork.canvas, 0, 0);
    Object.assign(element.style, { width: `${width}px`, height: `${height}px` }); element.append(canvas);
    // The original asset already carries its complete alpha mask. A second simplified
    // polygon clip cuts lettering, tails and icons that were preserved in that asset.
    // One version only: the reader never sees a choice between original and enhanced.
    return element;
  }
  private retire(shown: Shown, switching: boolean): void {
    const { element, source, target } = shown;
    element.classList.add("comic-bubble--leaving"); element.removeAttribute("role"); element.setAttribute("aria-hidden", "true");
    const animation = element.animate([
      { transform: "translate(0, 0) scale(1)" }, { transform: ComicBubbleView.transformFrom(source, target) },
    ], { duration: ComicBubbleView.reduced ? 1 : switching ? COMIC_BUBBLE_MOTION.closeMs - 40 : COMIC_BUBBLE_MOTION.closeMs,
      easing: "cubic-bezier(.4,0,.7,.2)", fill: "forwards" });
    const remove = (): void => element.remove();
    animation.addEventListener("finish", remove, { once: true }); animation.addEventListener("cancel", remove, { once: true });
  }
  private static get reduced(): boolean { return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; }
  public static transformFrom(source: ComicRect, target: ComicRect): string {
    const scale = source.width / Math.max(1, target.width);
    return `translate(${source.x - target.x}px, ${source.y - target.y}px) scale(${scale})`;
  }
}
