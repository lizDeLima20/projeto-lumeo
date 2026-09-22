import { ComicLayout, type ComicGeometry, type ComicRect } from "./ComicLayout";
import type { ComicFold, ComicPoint } from "./ComicFoldGeometry";
import type { ComicRestPages, ComicTurnPlan } from "./ComicSpreadMap";

export type ComicTheme = "light" | "dark";

/** Page bitmaps by page number, already rendered for the current geometry. */
export interface ComicBitmaps { get(page: number): HTMLCanvasElement | undefined; }

interface Palette { stage: string; paper: string; shade: string; }
const PALETTES: Record<ComicTheme, Palette> = {
  light: { stage: "#ebe7de", paper: "#f6f3ec", shade: "20, 16, 10" },
  dark: { stage: "#141412", paper: "#26251f", shade: "0, 0, 0" },
};

/** Draws the comic, at rest and while a leaf turns, onto ONE canvas.
 *
 *  Every page is a bitmap drawn into the slot the geometry gives it; nothing is a DOM
 *  layer, a clone or a transformed element. A frame is painted from scratch each time -
 *  the page below, the flat part of the front, the lifted part mirrored across the fold,
 *  and the shadows - so no surface can be left behind, peek out as a strip, or stack in
 *  the wrong order. */
export class ComicTurnRenderer {
  private readonly context: CanvasRenderingContext2D | null;
  private ratio = 1;

  public constructor(private readonly canvas: HTMLCanvasElement) {
    this.context = canvas.getContext("2d", { alpha: false });
  }

  public resize(width: number, height: number, devicePixelRatio: number): void {
    this.ratio = Math.max(1, Math.min(3, devicePixelRatio || 1));
    this.canvas.width = Math.max(1, Math.round(width * this.ratio));
    this.canvas.height = Math.max(1, Math.round(height * this.ratio));
    this.canvas.style.width = `${width}px`; this.canvas.style.height = `${height}px`;
  }

  /** Just the theme's background: a resized canvas is otherwise black until drawn. */
  public clear(geometry: ComicGeometry, theme: ComicTheme): void { this.begin(geometry, theme); }

  public drawRest(geometry: ComicGeometry, pages: ComicRestPages, bitmaps: ComicBitmaps, theme: ComicTheme): void {
    const context = this.begin(geometry, theme); if (!context) return;
    const palette = PALETTES[theme];
    const left = ComicLayout.slot(geometry, "left"), right = ComicLayout.slot(geometry, "right");
    this.bookShadow(context, geometry, pages.left !== null, pages.right !== null, palette);
    if (pages.left !== null) this.page(context, left, bitmaps.get(pages.left), palette);
    if (pages.right !== null) this.page(context, right, bitmaps.get(pages.right), palette);
    if (geometry.mode === "spread") this.gutter(context, geometry, pages.left !== null, pages.right !== null, palette);
  }

  public drawTurn(geometry: ComicGeometry, plan: ComicTurnPlan, fold: ComicFold, bitmaps: ComicBitmaps, theme: ComicTheme): void {
    const context = this.begin(geometry, theme); if (!context) return;
    const palette = PALETTES[theme];
    const left = ComicLayout.slot(geometry, "left"), right = ComicLayout.slot(geometry, "right");
    const spread = geometry.mode === "spread";
    // The lifted leaf casts its own shadow; the book's covers only the slots that hold a page.
    this.bookShadow(context, geometry, spread && plan.staticLeft !== null, true, palette);

    // 1. What never moves: the left page, and the page below the leaf (whole - the leaf
    //    about to be drawn over it is what keeps it covered until uncovered).
    if (spread && plan.staticLeft !== null) this.page(context, left, bitmaps.get(plan.staticLeft), palette);
    if (plan.under !== null) this.page(context, right, bitmaps.get(plan.under), palette);
    else this.empty(context, right, palette);
    if (spread) this.gutter(context, geometry, plan.staticLeft !== null, true, palette);

    // 2. The front, only where it still lies flat.
    if (fold.front.length) {
      context.save(); this.path(context, fold.front); context.clip();
      this.page(context, right, bitmaps.get(plan.front), palette);
      this.foldShade(context, fold, -1, geometry.pageWidth * .07, .16, palette);
      context.restore();
    }

    // 3. The shadow the lifted leaf casts on the page it uncovers, deepest at the fold where
    //    the paper rises. In leaf coordinates the lifted part and the uncovered part of the
    //    slot are the same polygon.
    const rise = Math.sin(Math.PI * fold.progress);
    if (fold.flap.length) {
      context.save(); this.path(context, fold.flap); context.clip();
      this.foldShade(context, fold, 1, geometry.pageWidth * (.08 + .1 * rise), .5 * rise + .06, palette);
      context.restore();
    }

    // 4. The lifted part: the leaf's back, mirrored across the fold and arched.
    if (fold.laid.length) {
      // Its shadow on whatever lies beneath its free edge.
      context.save();
      context.shadowColor = `rgba(${palette.shade}, ${.45 * rise + .1})`;
      context.shadowBlur = (10 + 26 * rise) * this.ratio;
      context.shadowOffsetX = -fold.normal.x * 6 * rise * this.ratio; context.shadowOffsetY = 4 * rise * this.ratio;
      this.path(context, fold.laid); context.fillStyle = palette.paper; context.fill();
      context.restore();
      context.save();
      context.transform(...fold.placement);
      this.path(context, fold.flap); context.clip();
      this.back(context, right, plan, bitmaps, palette);
      context.restore();
      // The bend, across the lifted paper: shade where it turns over at the fold, a sheen on
      // the crown of the arc, a little shade again towards its free edge.
      context.save(); this.path(context, fold.laid); context.clip();
      const reach = Math.max(...fold.laid.map(point => (fold.origin.x - point.x) * fold.normal.x + (fold.origin.y - point.y) * fold.normal.y), 1);
      const start = fold.origin, end = { x: start.x - fold.normal.x * reach, y: start.y - fold.normal.y * reach };
      const bend = context.createLinearGradient(start.x, start.y, end.x, end.y);
      bend.addColorStop(0, `rgba(${palette.shade}, ${.38 * rise + .08})`);
      bend.addColorStop(.16, `rgba(${palette.shade}, ${.12 * rise})`);
      bend.addColorStop(.42, `rgba(255, 255, 255, ${.14 * rise})`);
      bend.addColorStop(.75, "rgba(255, 255, 255, 0)");
      bend.addColorStop(1, `rgba(${palette.shade}, ${.16 * rise})`);
      context.fillStyle = bend; context.fillRect(0, 0, geometry.width, geometry.height);
      context.restore();
    }
  }

  /** The back of the leaf. On the desktop it is the next page - drawn mirrored in leaf
   *  coordinates so that the fold's own mirror sets it the right way round. On a phone
   *  the leaf has no printed back: paper, with the front showing faintly through. */
  private back(context: CanvasRenderingContext2D, slot: ComicRect, plan: ComicTurnPlan, bitmaps: ComicBitmaps, palette: Palette): void {
    context.fillStyle = palette.paper; context.fillRect(slot.x, slot.y, slot.width, slot.height);
    if (plan.back !== null) {
      context.save();
      context.translate(slot.x * 2 + slot.width, 0); context.scale(-1, 1);
      this.page(context, slot, bitmaps.get(plan.back), palette);
      context.restore();
      return;
    }
    const front = bitmaps.get(plan.front);
    if (!front) return;
    context.save(); context.globalAlpha = .1;
    const drawn = ComicLayout.contain(slot, front.width, front.height);
    context.drawImage(front, drawn.x, drawn.y, drawn.width, drawn.height);
    context.restore();
  }

  private begin(geometry: ComicGeometry, theme: ComicTheme): CanvasRenderingContext2D | null {
    const context = this.context; if (!context) return null;
    context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
    context.fillStyle = PALETTES[theme].stage;
    context.fillRect(0, 0, geometry.width, geometry.height);
    return context;
  }

  private page(context: CanvasRenderingContext2D, slot: ComicRect, bitmap: HTMLCanvasElement | undefined, palette: Palette): void {
    if (!bitmap) { this.empty(context, slot, palette); return; }
    const drawn = ComicLayout.contain(slot, bitmap.width, bitmap.height);
    if (drawn.width < slot.width - .5 || drawn.height < slot.height - .5) this.empty(context, slot, palette);
    context.drawImage(bitmap, drawn.x, drawn.y, drawn.width, drawn.height);
  }

  private empty(context: CanvasRenderingContext2D, slot: ComicRect, palette: Palette): void {
    context.fillStyle = palette.paper; context.fillRect(slot.x, slot.y, slot.width, slot.height);
  }

  /** A soft shadow under the whole book, so the spread sits on the desk. */
  private bookShadow(context: CanvasRenderingContext2D, geometry: ComicGeometry, left: boolean, right: boolean, palette: Palette): void {
    if (geometry.mode !== "spread" || (!left && !right)) return;
    const x = left ? geometry.spineX - geometry.pageWidth : geometry.spineX;
    const width = (left ? geometry.pageWidth : 0) + (right ? geometry.pageWidth : 0);
    context.save();
    context.shadowColor = `rgba(${palette.shade}, .38)`; context.shadowBlur = 28 * this.ratio; context.shadowOffsetY = 10 * this.ratio;
    context.fillStyle = palette.paper; context.fillRect(x, geometry.top, width, geometry.pageHeight);
    context.restore();
  }

  /** The spine: pages curve down into the binding. */
  private gutter(context: CanvasRenderingContext2D, geometry: ComicGeometry, left: boolean, right: boolean, palette: Palette): void {
    const width = Math.max(10, geometry.pageWidth * .06);
    const draw = (from: number, to: number): void => {
      const gradient = context.createLinearGradient(from, 0, to, 0);
      gradient.addColorStop(0, `rgba(${palette.shade}, .26)`); gradient.addColorStop(1, `rgba(${palette.shade}, 0)`);
      context.fillStyle = gradient;
      context.fillRect(Math.min(from, to), geometry.top, Math.abs(to - from), geometry.pageHeight);
    };
    if (left) draw(geometry.spineX, geometry.spineX - width);
    if (right) draw(geometry.spineX, geometry.spineX + width);
  }

  /** A band of shade along the fold line, towards `direction` (+1 the lifted side of the
   *  leaf, i.e. the uncovered page; -1 the flat side). */
  private foldShade(context: CanvasRenderingContext2D, fold: ComicFold, direction: 1 | -1, reach: number, strength: number, palette: Palette, sheen = false): void {
    if (strength <= 0) return;
    const start = fold.origin, end = { x: start.x + fold.normal.x * reach * direction, y: start.y + fold.normal.y * reach * direction };
    const gradient = context.createLinearGradient(start.x, start.y, end.x, end.y);
    gradient.addColorStop(0, `rgba(${palette.shade}, ${strength})`);
    if (sheen) { gradient.addColorStop(.45, "rgba(255, 255, 255, .07)"); gradient.addColorStop(1, "rgba(255, 255, 255, 0)"); }
    else gradient.addColorStop(1, `rgba(${palette.shade}, 0)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, context.canvas.width / this.ratio, context.canvas.height / this.ratio);
  }


  private path(context: CanvasRenderingContext2D, polygon: readonly ComicPoint[]): void {
    context.beginPath();
    polygon.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.closePath();
  }
}
