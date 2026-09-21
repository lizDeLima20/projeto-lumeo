import { I18nManager } from "../i18n/I18nManager";
import type { Book } from "../models/Book";
import { ComicBlockOverlay } from "../reader/comic/ComicBlockOverlay";
import { ComicPageEngine } from "../reader/comic/ComicPageEngine";
import { ComicPagePrefetchPlanner } from "../reader/comic/ComicPagePrefetchPlanner";
import { ComicPageProcessor } from "../reader/comic/ComicPageProcessor";
import { PdfTextLayerFragmentSource } from "../reader/comic/PdfTextLayerFragmentSource";
import { TesseractComicOcrSource } from "../reader/comic/TesseractComicOcrSource";
import { ReaderFileMissingError, type ReaderManager } from "../reader/ReaderManager";
import { ReaderDisplay } from "../services/ReaderDisplay";
import { BaseView } from "./BaseView";

/** The comic reader. It shares the library, the file store and the reading progress with the
 *  book reader and nothing else: no reflow, no pagination of text, no typography - a comic
 *  page is one picture, shown whole.
 *
 *  Reading order per page: draw the page, mount it, and only then start looking for its
 *  text blocks in the background. */
export class ComicReaderView extends BaseView {
  private readonly i18n = I18nManager.shared;
  private readonly engine = new ComicPageEngine();
  private readonly overlay = new ComicBlockOverlay();
  private readonly planner = new ComicPagePrefetchPlanner();
  private readonly processor: ComicPageProcessor;
  private stage: HTMLElement | null = null;
  private frame: HTMLElement | null = null;
  private indicator: HTMLElement | null = null;
  private book: Book | null = null;
  private currentPage = 1;
  private totalPages = 1;
  private resizeTimer = 0;
  private processing: AbortController | null = null;
  private pointerStartX = 0;
  private pointerStartY = 0;

  public constructor(private readonly bookId: string, private readonly manager: ReaderManager,
    private readonly globalTheme: "light" | "dark", private readonly onBack: () => void,
    private readonly onBookUpdated: (book: Book) => void) {
    super();
    this.processor = new ComicPageProcessor([new PdfTextLayerFragmentSource(), new TesseractComicOcrSource()]);
  }

  public render(): HTMLElement {
    const reader = this.createElement("section", "comic-reader");
    reader.dataset.readerTheme = this.globalTheme; reader.lang = this.i18n.locale;
    this.stage = this.createElement("div", "comic-stage"); this.stage.tabIndex = 0;
    this.frame = this.createElement("div", "comic-page");
    this.frame.append(this.overlay.render());
    const loading = this.createElement("p", "comic-loading", this.i18n.t("reader.loading")); loading.setAttribute("role", "status");
    this.stage.append(this.frame, loading);
    reader.append(this.stage, this.chrome());
    this.stage.addEventListener("pointerdown", this.handlePointerDown);
    this.stage.addEventListener("pointerup", this.handlePointerUp);
    document.body.classList.add("reader-mode");
    void ReaderDisplay.keepAwake();
    document.addEventListener("keydown", this.handleKeydown);
    window.addEventListener("resize", this.handleResize);
    queueMicrotask(() => void this.initialize());
    return reader;
  }

  public override unmount(): void {
    window.clearTimeout(this.resizeTimer);
    document.removeEventListener("keydown", this.handleKeydown);
    window.removeEventListener("resize", this.handleResize);
    document.body.classList.remove("reader-mode");
    void ReaderDisplay.allowSleep();
    this.processing?.abort(); this.processing = null;
    void this.processor.dispose(); void this.engine.close();
    super.unmount();
  }

  private chrome(): HTMLElement {
    const bar = this.createElement("div", "comic-controls");
    const back = this.button("‹", this.i18n.t("reader.back"), this.onBack, "comic-control comic-control--back");
    const previous = this.button("◀", this.i18n.t("reader.previousPage"), () => void this.go(this.currentPage - 1));
    const next = this.button("▶", this.i18n.t("reader.nextPage"), () => void this.go(this.currentPage + 1));
    this.indicator = this.createElement("span", "comic-indicator", "—");
    bar.append(back, previous, this.indicator, next);
    return bar;
  }

  private button(label: string, ariaLabel: string, action: () => void, className = "comic-control"): HTMLButtonElement {
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
      const saved = source.progress?.currentLocation?.match(/^comic:(\d+)$/);
      const restored = saved ? Number(saved[1]) : source.progress?.currentPage ?? 1;
      this.element?.querySelector(".comic-loading")?.remove();
      await this.go(Math.min(Math.max(1, restored), Math.max(1, this.totalPages)), false);
    } catch (error) { this.showError(error); }
  }

  private async go(pageNumber: number, save = true): Promise<void> {
    if (!this.frame || pageNumber < 1 || pageNumber > this.totalPages) return;
    // A page change always closes an open block first: the reader never carries a balloon
    // from one page onto the next.
    this.overlay.clear();
    this.processing?.abort();
    this.currentPage = pageNumber;
    const canvas = await this.engine.render(pageNumber, this.stageSize());
    if (!canvas || !this.frame) return;
    this.frame.replaceChildren(canvas, this.overlay.render());
    this.updateIndicator();
    if (save) await this.saveProgress();
    // The page is on screen now; recognition starts after it and never blocks it.
    this.scheduleProcessing(pageNumber);
  }

  private scheduleProcessing(pageNumber: number): void {
    const controller = new AbortController(); this.processing = controller;
    const run = async (): Promise<void> => {
      for (const page of this.planner.order(pageNumber, this.totalPages)) {
        if (controller.signal.aborted) return;
        if (this.processor.isProcessed(page)) { if (page === pageNumber) this.showBlocks(pageNumber); continue; }
        const canvas = await this.engine.render(page, this.stageSize()).catch(() => null);
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
    this.book = await this.manager.saveReflow(this.book, this.currentPage, this.totalPages, this.currentPage,
      this.currentPage >= this.totalPages, `comic:${this.currentPage}`);
    this.onBookUpdated(this.book);
  }

  private updateIndicator(): void {
    if (this.indicator) this.indicator.textContent = `${this.currentPage} / ${this.totalPages}`;
  }

  private stageSize(): { width: number; height: number } {
    return { width: this.stage?.clientWidth || window.innerWidth, height: this.stage?.clientHeight || window.innerHeight };
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

  private readonly handlePointerDown = (event: PointerEvent): void => { this.pointerStartX = event.clientX; this.pointerStartY = event.clientY; };
  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.overlay.openBlockId) return;
    const deltaX = event.clientX - this.pointerStartX, deltaY = event.clientY - this.pointerStartY;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return;
    void this.go(deltaX < 0 ? this.currentPage + 1 : this.currentPage - 1);
  };
  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "ArrowRight") void this.go(this.currentPage + 1);
    if (event.key === "ArrowLeft") void this.go(this.currentPage - 1);
    if (event.key === "Escape") this.overlay.close();
  };
  /** Coordinates are normalized, so a resize only needs a new bitmap - never a new pass
   *  over the text. */
  private readonly handleResize = (): void => {
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => { this.engine.invalidate(); void this.redraw(); }, 180);
  };
  private async redraw(): Promise<void> {
    if (!this.frame) return;
    const canvas = await this.engine.render(this.currentPage, this.stageSize());
    if (!canvas || !this.frame) return;
    this.frame.replaceChildren(canvas, this.overlay.render());
    this.showBlocks(this.currentPage);
  }
}
