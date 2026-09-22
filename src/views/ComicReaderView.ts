import { Capacitor } from "@capacitor/core";
import { I18nManager } from "../i18n/I18nManager";
import type { Book } from "../models/Book";
import { ComicBlockOverlay } from "../reader/comic/ComicBlockOverlay";
import { ComicLayout, type ComicGeometry, type ComicRect } from "../reader/comic/ComicLayout";
import { ComicPageEngine, type ComicStageSize } from "../reader/comic/ComicPageEngine";
import { ComicPagePrefetchPlanner } from "../reader/comic/ComicPagePrefetchPlanner";
import { ComicPageProcessor } from "../reader/comic/ComicPageProcessor";
import { ComicSpreadMap, type ComicTurnPlan } from "../reader/comic/ComicSpreadMap";
import { ComicTurnController } from "../reader/comic/ComicTurnController";
import { ComicTurnRenderer, type ComicTheme } from "../reader/comic/ComicTurnRenderer";
import type { ComicFold } from "../reader/comic/ComicFoldGeometry";
import { PdfTextLayerFragmentSource } from "../reader/comic/PdfTextLayerFragmentSource";
import { TesseractComicOcrSource } from "../reader/comic/TesseractComicOcrSource";
import { ReaderFileMissingError, type ReaderManager } from "../reader/ReaderManager";
import { BaseView } from "./BaseView";

const THEME_KEY = "lumeo.comic.theme";

/** The comic reader: its own engine, sharing with the book reader only the library, the
 *  file store and the reading progress.
 *
 *  The comic is painted on one canvas from page bitmaps rendered ahead of time. A phone,
 *  a tablet and the Android app show one page; a wide desktop window shows the book open
 *  on two. Either way one geometry serves every state of a turn, and the pages a turn can
 *  show are drawn before the reader's hand reaches the page.
 *
 *  Reading order per page: draw the page, and only then look for its text blocks - in the
 *  background, under the transparent overlay that sits on the page's artwork. */
export class ComicReaderView extends BaseView {
  private readonly i18n = I18nManager.shared;
  private readonly engine = new ComicPageEngine();
  private readonly overlay = new ComicBlockOverlay();
  private readonly planner = new ComicPagePrefetchPlanner();
  private readonly processor: ComicPageProcessor;
  private readonly bitmaps = new Map<number, { canvas: HTMLCanvasElement; key: string }>();
  private stage: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private overlaySlot: HTMLElement | null = null;
  private progressLabel: HTMLElement | null = null;
  private renderer: ComicTurnRenderer | null = null;
  private controller: ComicTurnController | null = null;
  private map: ComicSpreadMap | null = null;
  private geometry: ComicGeometry | null = null;
  private theme: ComicTheme;
  private book: Book | null = null;
  private totalPages = 0;
  private aspect = 2 / 3;
  private position = 0;
  private queue: Promise<void> = Promise.resolve();
  private resizeTimer = 0;
  private labelTimer = 0;
  private processing: AbortController | null = null;
  private disposed = false;

  public constructor(private readonly bookId: string, private readonly manager: ReaderManager,
    globalTheme: "light" | "dark", private readonly onBack: () => void,
    private readonly onBookUpdated: (book: Book) => void) {
    super();
    this.processor = new ComicPageProcessor([new PdfTextLayerFragmentSource(), new TesseractComicOcrSource()]);
    this.theme = ComicReaderView.storedTheme() ?? globalTheme;
  }

  public render(): HTMLElement {
    // mount() calls unmount() before render(): this view is live again from here on.
    this.disposed = false;
    const reader = this.createElement("section", "comic-reader");
    reader.dataset.readerTheme = this.theme; reader.lang = this.i18n.locale;
    this.stage = this.createElement("div", "comic-stage"); this.stage.tabIndex = 0;
    this.canvas = this.createElement("canvas", "comic-canvas"); this.canvas.setAttribute("aria-hidden", "true");
    this.overlaySlot = this.createElement("div", "comic-overlay-slot");
    this.overlaySlot.append(this.overlay.render());
    const loading = this.createElement("p", "comic-loading", this.i18n.t("reader.loading")); loading.setAttribute("role", "status");
    this.stage.append(this.canvas, this.overlaySlot, loading);
    this.progressLabel = this.createElement("span", "comic-progress"); this.progressLabel.setAttribute("aria-live", "polite");
    reader.append(this.stage, ...this.chrome(), this.progressLabel);
    this.renderer = new ComicTurnRenderer(this.canvas);
    this.controller = new ComicTurnController(this.stage, this.host);
    this.controller.bind();
    document.body.classList.add("reader-mode");
    document.addEventListener("keydown", this.handleKeydown);
    window.addEventListener("resize", this.handleResize);
    queueMicrotask(() => void this.initialize());
    return reader;
  }

  public override unmount(): void {
    this.disposed = true;
    window.clearTimeout(this.resizeTimer); window.clearTimeout(this.labelTimer);
    document.removeEventListener("keydown", this.handleKeydown);
    window.removeEventListener("resize", this.handleResize);
    document.body.classList.remove("reader-mode");
    this.controller?.unbind(); this.controller = null;
    this.processing?.abort(); this.processing = null;
    this.bitmaps.clear();
    void this.processor.dispose(); void this.engine.close();
    super.unmount();
  }

  /** The Lumeo reader's own round buttons - back, and the light/dark switch - plus, on the
   *  open book, the arrows beside it. No bar of the comic's own. */
  private chrome(): HTMLElement[] {
    const back = this.button("‹", this.i18n.t("reader.back"), this.onBack, "comic-fab comic-fab--back");
    const theme = this.button(this.theme === "dark" ? "☀" : "☾", this.i18n.t("reader.theme"), () => this.toggleTheme(theme), "comic-fab comic-fab--theme");
    theme.title = this.i18n.t(this.theme === "dark" ? "reader.theme.light" : "reader.theme.dark");
    const previous = this.button("←", this.i18n.t("reader.previousPage"), () => void this.controller?.turn(-1), "comic-arrow comic-arrow--previous");
    const next = this.button("→", this.i18n.t("reader.nextPage"), () => void this.controller?.turn(1), "comic-arrow comic-arrow--next");
    return [back, theme, previous, next];
  }

  private button(label: string, ariaLabel: string, action: () => void, className: string): HTMLButtonElement {
    const button = this.createElement("button", className, label);
    button.type = "button"; button.setAttribute("aria-label", ariaLabel); button.addEventListener("click", action);
    return button;
  }

  private async initialize(): Promise<void> {
    try {
      const source = await this.manager.source(this.bookId);
      if (source.book.fileType !== "pdf") throw new ReaderFileMissingError(this.i18n.t("reader.comic.pdfOnly"));
      this.book = source.book;
      this.totalPages = await this.engine.open(source.blob);
      // The book's page shape, from a few pages - read from the PDF, nothing is drawn.
      const samples = await Promise.all(Array.from({ length: Math.min(8, this.totalPages) }, (_, index) => this.engine.aspect(index + 1)));
      this.aspect = ComicLayout.aspect(samples.filter((value): value is number => value !== null));
      const saved = source.progress?.currentLocation?.match(/^comic:(\d+)$/);
      const restored = Math.min(Math.max(1, saved ? Number(saved[1]) : source.progress?.currentPage ?? 1), Math.max(1, this.totalPages));
      this.layout(restored);
      // Only the pages on screen hold the opening; the ones a turn needs follow at once.
      const rest = this.map!.rest(this.position);
      await this.ensure([rest.left, rest.right].filter((page): page is number => page !== null));
      if (this.disposed) return;
      this.element?.querySelector(".comic-loading")?.remove();
      this.arrived(false);
    } catch (error) { this.showError(error); }
  }

  /** Measures the stage and fixes the geometry every state will use until the next resize. */
  private layout(page: number): void {
    if (!this.stage || !this.renderer) return;
    const width = this.stage.clientWidth || window.innerWidth, height = this.stage.clientHeight || window.innerHeight;
    const mode = ComicLayout.mode(width, height, { native: Capacitor.isNativePlatform(), finePointer: matchMedia("(pointer: fine)").matches });
    this.geometry = ComicLayout.geometry(mode, width, height, this.aspect);
    this.map = new ComicSpreadMap(this.totalPages, mode);
    this.position = this.map.positionOfPage(page);
    this.renderer.resize(width, height, window.devicePixelRatio || 1);
    this.renderer.clear(this.geometry, this.theme);
    if (this.element) this.element.dataset.mode = mode;
  }

  private get currentPage(): number { return this.map?.pageOfPosition(this.position) ?? 1; }

  private get slotSize(): ComicStageSize {
    return { width: this.geometry?.pageWidth ?? 1, height: this.geometry?.pageHeight ?? 1 };
  }

  /** Renders the given pages, in order, for the current page slot. One PDF render at a
   *  time, so the page needed first is never queued behind a prefetch. */
  private ensure(pages: readonly number[]): Promise<void> {
    const key = ComicPageEngine.stageKey(this.slotSize), size = this.slotSize;
    const work = this.queue.then(async () => {
      for (const page of pages) {
        if (this.disposed) return;
        const known = this.bitmaps.get(page);
        if (known && known.key === key && known.canvas.width > 0) continue;
        const canvas = await this.engine.render(page, size).catch(() => null);
        if (canvas && !this.disposed) this.bitmaps.set(page, { canvas, key });
      }
    });
    this.queue = work.catch(() => undefined);
    return work;
  }

  private bitmap(page: number): HTMLCanvasElement | undefined {
    const known = this.bitmaps.get(page);
    return known && known.canvas.width > 0 ? known.canvas : undefined;
  }

  private readonly bitmapSource = { get: (page: number) => this.bitmap(page) };

  private pagesOf(plan: ComicTurnPlan): number[] {
    return [plan.staticLeft, plan.front, plan.back, plan.under].filter((page): page is number => page !== null);
  }

  /** Everything the turn controller may ask of the reader. */
  private readonly host = {
    geometry: (): ComicGeometry => this.geometry ?? ComicLayout.geometry("single", 1, 1, this.aspect),
    plan: (direction: 1 | -1): ComicTurnPlan | null => this.map?.plan(this.position, direction) ?? null,
    ready: (plan: ComicTurnPlan): boolean => this.pagesOf(plan).every(page => this.bitmap(page) !== undefined),
    prepare: (plan: ComicTurnPlan): Promise<void> => this.ensure(this.pagesOf(plan)),
    drawTurn: (plan: ComicTurnPlan, fold: ComicFold): void => {
      if (this.geometry) this.renderer?.drawTurn(this.geometry, plan, fold, this.bitmapSource, this.theme);
    },
    drawRest: (): void => this.drawRest(),
    commit: (plan: ComicTurnPlan): void => { this.position = plan.target; this.arrived(true); },
    turning: (active: boolean): void => {
      if (active) this.overlay.close();
      this.overlaySlot?.classList.toggle("comic-overlay-slot--hidden", active);
    },
  };

  private drawRest(): void {
    if (!this.geometry || !this.map) return;
    this.renderer?.drawRest(this.geometry, this.map.rest(this.position), this.bitmapSource, this.theme);
    this.placeOverlay();
  }

  /** A new position is on screen: show it, remember it, then prepare the next turns and
   *  the page's text blocks, in that order. */
  private arrived(save: boolean): void {
    this.overlay.clear();
    this.processing?.abort();
    this.drawRest();
    this.showProgress();
    if (save) void this.saveProgress();
    void this.ensure(this.map?.neededPages(this.position) ?? []).then(() => { if (!this.disposed && this.controller?.state === "IDLE") this.drawRest(); });
    this.scheduleProcessing(this.currentPage);
  }

  /** The block overlay lies exactly on the artwork of the page being read. */
  private placeOverlay(): void {
    const slot = this.overlaySlot; if (!slot || !this.geometry || !this.map) return;
    const page = this.currentPage, rest = this.map.rest(this.position);
    const side = rest.left === page ? "left" : "right";
    const box: ComicRect = ComicLayout.slot(this.geometry, side);
    const bitmap = this.bitmap(page);
    const art = bitmap ? ComicLayout.contain(box, bitmap.width, bitmap.height) : box;
    Object.assign(slot.style, { left: `${art.x}px`, top: `${art.y}px`, width: `${art.width}px`, height: `${art.height}px` });
  }

  private showProgress(): void {
    const label = this.progressLabel; if (!label || !this.map) return;
    const rest = this.map.rest(this.position);
    const shown = [rest.left, rest.right].filter((page): page is number => page !== null);
    label.textContent = `${shown.join("–")} / ${this.totalPages}`;
    label.classList.add("comic-progress--visible");
    window.clearTimeout(this.labelTimer);
    this.labelTimer = window.setTimeout(() => label.classList.remove("comic-progress--visible"), 1600);
  }

  private scheduleProcessing(pageNumber: number): void {
    const controller = new AbortController(); this.processing = controller;
    const size = this.slotSize;
    const run = async (): Promise<void> => {
      for (const page of this.planner.order(pageNumber, this.totalPages)) {
        if (controller.signal.aborted) return;
        if (this.processor.isProcessed(page)) { if (page === pageNumber) this.showBlocks(pageNumber); continue; }
        const canvas = this.bitmap(page) ?? await this.engine.render(page, size).catch(() => null);
        const result = await this.processor.process({ pageNumber: page, page: await this.engine.page(page), canvas }, controller.signal);
        if (controller.signal.aborted) return;
        if (page === pageNumber && result.blocks.length) this.showBlocks(pageNumber);
      }
    };
    const start = (): void => { void run(); };
    if (typeof requestIdleCallback === "function") requestIdleCallback(start, { timeout: 600 }); else window.setTimeout(start, 32);
  }

  private showBlocks(pageNumber: number): void {
    if (pageNumber !== this.currentPage) return;
    const prepared = this.processor.cached(pageNumber); if (!prepared) return;
    this.overlay.setBlocks(prepared.blocks);
    if (this.stage) this.stage.dataset.blocks = prepared.blocks.length ? "ready" : "none";
  }

  private async saveProgress(): Promise<void> {
    if (!this.book) return;
    const page = this.currentPage;
    this.book = await this.manager.saveReflow(this.book, page, this.totalPages, page, page >= this.totalPages, `comic:${page}`);
    this.onBookUpdated(this.book);
  }

  private toggleTheme(button: HTMLButtonElement): void {
    this.theme = this.theme === "dark" ? "light" : "dark";
    if (this.element) this.element.dataset.readerTheme = this.theme;
    button.textContent = this.theme === "dark" ? "☀" : "☾";
    button.title = this.i18n.t(this.theme === "dark" ? "reader.theme.light" : "reader.theme.dark");
    try { localStorage.setItem(THEME_KEY, this.theme); } catch { /* the choice just is not remembered */ }
    if (this.controller?.state === "IDLE") this.drawRest();
  }

  private static storedTheme(): ComicTheme | null {
    try { const value = localStorage.getItem(THEME_KEY); return value === "light" || value === "dark" ? value : null; }
    catch { return null; }
  }

  private showError(error: unknown): void {
    if (!this.element) return;
    this.element.replaceChildren();
    const box = this.createElement("div", "comic-error");
    box.append(this.createElement("h1", "section-title", this.i18n.t("reader.comic.openFailed")),
      this.createElement("p", undefined, error instanceof Error ? error.message : this.i18n.t("reader.comic.openFailed")));
    const back = this.createElement("button", "button button--primary", this.i18n.t("reader.back"));
    back.type = "button"; back.addEventListener("click", this.onBack);
    box.append(back); this.element.append(box);
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    // Keys turn the same physical leaf as a hand or a tap does.
    if (event.key === "ArrowRight") void this.controller?.turn(1);
    if (event.key === "ArrowLeft") void this.controller?.turn(-1);
    if (event.key === "Escape") this.overlay.close();
  };

  /** A resize or rotation: the page is re-laid out at once with the bitmaps it already
   *  has (contained, so never deformed), then redrawn sharp for its new size. */
  private readonly handleResize = (): void => {
    if (!this.map || !this.geometry) return;
    this.controller?.interrupt();
    this.layout(this.currentPage);
    this.drawRest();
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      this.engine.invalidate();
      void this.ensure(this.map?.neededPages(this.position) ?? []).then(() => { if (!this.disposed && this.controller?.state === "IDLE") this.drawRest(); });
    }, 180);
  };
}
