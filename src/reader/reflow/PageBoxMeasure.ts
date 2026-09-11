import type { PageRhythm, TextMeasure } from "./PaginationEngine";

export interface MeasuredPage { content: { width: number; height: number }; rhythm: PageRhythm; measure: TextMeasure; }

/** Reads the real text box of a page by building one, invisibly, exactly where the reader
 *  would, from the same classes and the same stylesheet.
 *
 *  Pagination used to guess instead: 56px of vertical margin while the sheet's padding was
 *  ~122px, lines as wide as 680px while a page of the open spread had ~451px, and an
 *  average character width for every font. Each guess put more text on a page than the
 *  page could show, and the rest was clipped off the bottom. */
export class PageBoxMeasure {
  public static readonly maxFitAttempts = 4;
  private static readonly sample = "Amostra";

  /** Null when nothing can be laid out yet (reader detached, no canvas), so callers fall
   *  back to the estimate and measure again once mounted. `safety` shaves that many pixels
   *  off the height, for the overflow guard. */
  public static measure(reader: HTMLElement, spread: boolean, safety = 0): MeasuredPage | null {
    if (typeof document === "undefined" || !reader.isConnected) return null;
    const stage = PageBoxMeasure.node("div", "reader-stage reader-stage--reflow");
    stage.setAttribute("aria-hidden", "true");
    stage.style.cssText = "position:absolute;inset:0;visibility:hidden;pointer-events:none;z-index:-1";
    const pages = PageBoxMeasure.node("div", "reflow-pages"); stage.append(pages);
    let page: HTMLElement;
    if (spread) {
      const reader$ = PageBoxMeasure.node("div", "desktop-book-reader"), book = PageBoxMeasure.node("div", "open-book-layout");
      page = PageBoxMeasure.node("article", "open-book-page open-book-page--right");
      book.append(PageBoxMeasure.node("article", "open-book-page open-book-page--left"), page);
      reader$.append(PageBoxMeasure.node("button", "open-book-arrow"), book, PageBoxMeasure.node("button", "open-book-arrow"));
      pages.append(reader$);
    } else {
      page = PageBoxMeasure.node("article", "reflow-sheet reflow-sheet--current"); pages.append(page);
    }
    const heading = PageBoxMeasure.node("h2", "reader-heading"), paragraph = PageBoxMeasure.node("p", "reader-paragraph");
    heading.textContent = PageBoxMeasure.sample; paragraph.textContent = PageBoxMeasure.sample;
    page.append(heading, paragraph); reader.append(stage);
    try {
      const box = getComputedStyle(page), p = getComputedStyle(paragraph), h = getComputedStyle(heading);
      const width = page.clientWidth - PageBoxMeasure.px(box.paddingLeft, 0) - PageBoxMeasure.px(box.paddingRight, 0);
      const height = page.clientHeight - PageBoxMeasure.px(box.paddingTop, 0) - PageBoxMeasure.px(box.paddingBottom, 0) - safety;
      const context = document.createElement("canvas").getContext("2d");
      if (!(width > 0 && height > 0) || !context) return null;
      const size = PageBoxMeasure.px(p.fontSize, 16), headingSize = PageBoxMeasure.px(h.fontSize, size * 1.35);
      const rhythm: PageRhythm = {
        lineHeight: PageBoxMeasure.px(p.lineHeight, size * 1.5),
        paragraphGap: PageBoxMeasure.px(p.marginTop, 0) + PageBoxMeasure.px(p.marginBottom, 0),
        headingLineHeight: PageBoxMeasure.px(h.lineHeight, headingSize * 1.25),
        headingMarginTop: PageBoxMeasure.px(h.marginTop, 0), headingMarginBottom: PageBoxMeasure.px(h.marginBottom, 0),
      };
      const fonts = { paragraph: PageBoxMeasure.font(p), heading: PageBoxMeasure.font(h) };
      const measure: TextMeasure = (text, kind) => { context.font = fonts[kind]; return context.measureText(text).width; };
      return { content: { width, height }, rhythm, measure };
    } finally { stage.remove(); }
  }

  private static node(tag: string, className: string): HTMLElement { const element = document.createElement(tag); element.className = className; return element; }
  private static px(value: string, fallback: number): number { const number = parseFloat(value); return Number.isFinite(number) ? number : fallback; }
  /** Built explicitly: the computed `font` shorthand can carry a line-height the canvas
   *  would reject, and some engines leave it empty. */
  private static font(style: CSSStyleDeclaration): string { return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`; }
}
