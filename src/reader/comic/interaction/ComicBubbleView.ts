import type { ComicRect } from "../ComicLayout";
import { comicBubbleTarget, comicBubbleText, type ComicBubbleTarget } from "./ComicBubbleLayout";
import type { ComicTextRegion } from "./ComicInteractionTypes";
import { comicArtworkCanvas, type ComicOriginalArt } from "./ComicObjectArtwork";

export const COMIC_BUBBLE_MOTION = { openMs: 340, closeMs: 240 } as const;
interface Shown { region: ComicTextRegion; source: ComicRect; target: ComicBubbleTarget; element: HTMLElement }

/** Original artwork only. OCR is accessibility metadata, never visible lettering. */
export class ComicBubbleView {
  private shown: Shown | null = null;
  private request = 0;
  public constructor(private readonly layer: HTMLElement, private readonly options: {
    compact: () => boolean;
    art?: (region: ComicTextRegion) => ComicOriginalArt | null | Promise<ComicOriginalArt | null>;
    onClose?: () => void;
  }) {}
  public get activeRegion(): ComicTextRegion | null { return this.shown?.region ?? null; }
  public get isOpen(): boolean { return this.shown !== null; }
  public async open(region: ComicTextRegion, source: ComicRect): Promise<void> {
    if (this.shown?.region.id === region.id) return;
    const request = ++this.request;
    let art: ComicOriginalArt | null;
    try { art = await this.options.art?.(region) ?? null; } catch { return; }
    if (!art || request !== this.request) return;
    const viewport = { width: this.layer.clientWidth || window.innerWidth, height: this.layer.clientHeight || window.innerHeight };
    const target = comicBubbleTarget({ source, viewport, compact: this.options.compact(), region });
    const element = ComicBubbleView.build(region, target.width, target.height, art);
    Object.assign(element.style, { left: `${target.x}px`, top: `${target.y}px`, width: `${target.width}px`, height: `${target.height}px` });
    this.layer.append(element);
    const previous = this.shown; this.shown = { region, source, target, element };
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
  public destroy(): void { this.closeNow(); }
  public static build(region: ComicTextRegion, width: number, height: number, art: ComicOriginalArt): HTMLElement {
    const element = document.createElement("div"); element.className = "comic-bubble"; element.tabIndex = -1;
    element.setAttribute("role", "dialog"); element.setAttribute("aria-label", comicBubbleText(region.text).slice(0, 200));
    element.dataset.regionId = region.id; element.dataset.visual = art.fallback ? "original-crop-fallback" : "original-object";
    element.dataset.review = region.recognitionStatus ?? "needs-review";
    const canvas = comicArtworkCanvas(art); canvas.className = "comic-bubble__art"; canvas.setAttribute("aria-hidden", "true");
    Object.assign(element.style, { width: `${width}px`, height: `${height}px` }); element.append(canvas);
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
