import type { ComicRect } from "../ComicLayout";
import { comicArtworkCanvas, type ComicOriginalArt } from "./ComicObjectArtwork";
import type { ComicTextRegion } from "./ComicInteractionTypes";
import { comicReadingSequence } from "./ComicReadingOrder";

export const COMIC_HINT = {
  /** Reading time before the first nudge, and the quiet gap between nudges. */
  firstDelayMs: 7000,
  repeatMs: 17000,
  /** A session gets a few nudges at most, and stops early once the reader has understood. */
  maxPerSession: 3,
  learnedAfterOpens: 2,
  /** A few per cent, and a breath: enough to catch the eye, not enough to read as a button. */
  growth: 1.05,
  durationMs: 820,
  /** Smaller than this on screen and the movement would not be seen at all. Measured on a
   *  phone in landscape, where a whole page is 336px tall and its balloons are tiny. */
  minWidthPx: 18,
  minHeightPx: 12,
} as const;

export interface ComicHintTarget { region: ComicTextRegion; rect: ComicRect; }

/** When to nudge, which region, and when to stop - with no DOM in sight, so the rules can
 *  be read and tested on their own. */
export class ComicHintPolicy {
  private shown = 0;
  private opened = 0;
  /** How far down the page the reader is taken to be: nothing at or before this point is
   *  offered again, whether they read it or it was already pointed at. */
  private cursor = 0;
  private readonly served = new Set<string>();

  public constructor(private readonly reduced: () => boolean = () => false) {}

  /** The lesson has landed - or the reader asked for less movement on screen. */
  public get finished(): boolean {
    return this.shown >= COMIC_HINT.maxPerSession || this.opened >= COMIC_HINT.learnedAfterOpens || this.reduced();
  }

  /** A balloon was opened. It counts as read, and so does everything before it: someone
   *  who goes straight to the third balloon is not sent back to the first. */
  public noteOpened(region?: ComicTextRegion): void {
    this.opened++;
    this.advance(region);
  }

  /** A nudge was given. The reader may ignore it, so the next one moves on regardless. */
  public noteShown(region: ComicTextRegion): void {
    this.shown++;
    this.advance(region);
  }

  /** A new page: the reader starts at its first balloon again. */
  public reset(): void { this.cursor = 0; this.served.clear(); }

  private advance(region?: ComicTextRegion): void {
    if (!region) return;
    this.served.add(region.id);
    this.cursor = Math.max(this.cursor, region.readingOrder ?? 0);
  }

  /** The next balloon the reader is likely to want, which is the next one in reading
   *  order they have not reached yet - not whichever happens to be nearby. Regions too
   *  small to be seen moving are passed over. */
  public pick(targets: readonly ComicHintTarget[]): ComicHintTarget | null {
    const visible = targets.filter(target => target.rect.width >= COMIC_HINT.minWidthPx
      && target.rect.height >= COMIC_HINT.minHeightPx && !this.served.has(target.region.id));
    if (visible.length === 0) return null;
    const ordered = comicReadingSequence(visible.map(target => target.region));
    const ahead = ordered.find(region => (region.readingOrder ?? 0) > this.cursor)
      ?? ordered.find(region => region.readingOrder === undefined);
    return ahead ? visible.find(target => target.region.id === ahead.id) ?? null : null;
  }
}

/** A piece of the page: the artwork a region covers, in the decoded page's own pixels. */
export type ComicHintArt = ComicOriginalArt;

export interface ComicHintOptions {
  /** The regions on screen right now, with their rectangles in stage pixels. */
  targets: () => readonly ComicHintTarget[];
  /** The artwork behind a region, so what moves is the balloon the artist drew. */
  art: (region: ComicTextRegion) => ComicHintArt | null | Promise<ComicHintArt | null>;
  /** False whenever a nudge would be in the way: a turn, an open balloon, a busy page. */
  idle: () => boolean;
  reduced?: () => boolean;
}

/** Teaches, once, that some of the drawing answers to a touch.
 *
 *  After a while of quiet reading one visible balloon is copied onto itself, swells by a
 *  few per cent, wobbles and settles back exactly where it was, then disappears. There is
 *  no button, no outline and no badge: what the reader sees is a balloon that moved a
 *  little. It happens to one region at a time, rarely, never during a page turn or with a
 *  balloon open, and it stops for good once the reader has opened a couple of balloons -
 *  the lesson has landed. A touch or the beginning of a swipe cancels it immediately. */
export class ComicHintAnimator {
  private timer = 0;
  private playing: { element: HTMLElement; animation: Animation } | null = null;
  private destroyed = false;
  private request = 0;
  private readonly policy: ComicHintPolicy;

  public constructor(private readonly layer: HTMLElement, private readonly options: ComicHintOptions) {
    this.policy = new ComicHintPolicy(() => options.reduced?.() ?? ComicHintAnimator.reducedMotion);
  }

  /** Called whenever the page settles: starts the countdown to the next nudge. */
  public schedule(delayMs: number = COMIC_HINT.firstDelayMs): void {
    this.stopTimer();
    if (this.destroyed || this.finished) return;
    this.timer = window.setTimeout(() => { this.timer = 0; this.play(); }, delayMs);
  }

  /** The reader is doing something: any nudge in flight is over, and the countdown
   *  restarts from the beginning so nothing happens under a moving finger. */
  public interrupt(): void {
    this.cancel();
    this.stopTimer();
  }

  /** The reader opened a balloon: they know. A couple of those and the hints end. */
  public noteOpened(region?: ComicTextRegion): void {
    this.policy.noteOpened(region);
    this.interrupt();
  }

  /** A different page is on screen: reading starts again at its first balloon. */
  public rewind(): void { this.policy.reset(); }

  public cancel(): void {
    this.request++;
    const playing = this.playing; this.playing = null;
    if (!playing) return;
    playing.animation.cancel();
    playing.element.remove();
  }

  public destroy(): void { this.destroyed = true; this.interrupt(); }

  private get finished(): boolean { return this.policy.finished; }

  private async play(): Promise<void> {
    if (this.destroyed || this.finished || this.playing) return;
    if (!this.options.idle()) { this.schedule(COMIC_HINT.repeatMs); return; }
    const target = this.policy.pick(this.options.targets());
    if (!target) { this.schedule(COMIC_HINT.repeatMs); return; }
    // At this size nothing drawn again could pass for hand lettering, so what moves is the
    // page itself - cut to the container's own outline, which is what keeps the panel, the
    // fire behind the balloon and the balloon next door out of the movement.
    const request = ++this.request;
    let art: ComicHintArt | null;
    try { art = await this.options.art(target.region); } catch { this.schedule(COMIC_HINT.repeatMs); return; }
    if (this.destroyed || request !== this.request || !this.options.idle()) return;
    if (!art) { this.schedule(COMIC_HINT.repeatMs); return; }
    const element = document.createElement("div");
    element.className = "comic-hint";
    element.setAttribute("aria-hidden", "true");
    Object.assign(element.style, { left: `${target.rect.x}px`, top: `${target.rect.y}px`,
      width: `${target.rect.width}px`, height: `${target.rect.height}px`, pointerEvents: "none" });
    element.dataset.regionId = target.region.id;
    element.dataset.visual = art.fallback ? "original-crop-fallback" : "original-object";
    const canvas = comicArtworkCanvas(art);
    element.append(canvas);
    this.layer.append(element);

    const { growth } = COMIC_HINT;
    const animation = element.animate([
      { transform: "scale(1) rotate(0deg)", offset: 0 },
      { transform: `scale(${growth}) rotate(-.5deg)`, offset: .3 },
      { transform: `scale(${growth}) rotate(.6deg)`, offset: .52 },
      { transform: `scale(${(1 + growth) / 2}) rotate(-.25deg)`, offset: .74 },
      { transform: "scale(1) rotate(0deg)", offset: 1 },
    ], { duration: COMIC_HINT.durationMs, easing: "ease-in-out" });
    this.playing = { element, animation };
    this.policy.noteShown(target.region);
    const done = (): void => {
      if (this.playing?.element === element) this.playing = null;
      element.remove();
      this.schedule(COMIC_HINT.repeatMs);
    };
    animation.addEventListener("finish", done, { once: true });
    animation.addEventListener("cancel", () => element.remove(), { once: true });
  }

  private stopTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = 0; }
  }

  private static get reducedMotion(): boolean {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
}
