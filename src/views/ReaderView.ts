import type { Book } from "../models/Book";
import { EpubReaderUnavailableError, ReaderFileMissingError, ReaderManager, type ReaderPageState } from "../reader/ReaderManager";
import { PdfPasswordCancelledError } from "../reader/PdfReaderEngine";
import { BaseView } from "./BaseView";
import { ReaderToolbar, type ReaderToolbarActions } from "./ReaderToolbar";
import { ReflowReaderEngine } from "../reader/reflow/ReflowReaderEngine";
import { PageTurnController } from "../reader/reflow/PageTurnController";
import { DesktopBookReaderView } from "./DesktopBookReaderView";
import { ReaderLayoutPolicy } from "../reader/premium/ReaderLayoutPolicy";
import { PageBoxMeasure } from "../reader/reflow/PageBoxMeasure";
import type { PaginationMetrics } from "../reader/reflow/PaginationEngine";
import { OpenBookNavigationController } from "../reader/desktop/OpenBookNavigationController";
import { ReaderSettingsPanel } from "./ReaderSettingsPanel";
import { FontSettingsController } from "../reader/settings/FontSettingsController";
import { PaperSettingsController } from "../reader/settings/PaperSettingsController";
import { LayoutSettingsController } from "../reader/settings/LayoutSettingsController";
import { AnimationSettingsController } from "../reader/settings/AnimationSettingsController";
import { ImageSettingsController } from "../reader/settings/ImageSettingsController";
import { IndexedDbService } from "../services/IndexedDbService";
import { HighlightRepository } from "../repositories/HighlightRepository";
import { AnnotationRepository } from "../repositories/AnnotationRepository";
import { BookmarkRepository } from "../repositories/BookmarkRepository";
import { HighlightManager, type TextAnchor } from "../reader/study/HighlightManager";
import { AnnotationManager } from "../reader/study/AnnotationManager";
import { BookmarkManager } from "../reader/study/BookmarkManager";
import { ReadingAnchorService } from "../reader/study/ReadingAnchorService";
import { TextSelectionManager } from "../reader/study/TextSelectionManager";
import { SelectionContextMenu } from "./SelectionContextMenu";
import { StudyPanel } from "./StudyPanel";
import type { ReaderCoverPage, ReaderPage, ReaderParagraph } from "../reader/reflow/ReaderDocument";
import type { Highlight, HighlightColor } from "../models/Highlight";
import type { BookmarkData } from "../models/Bookmark";
import { StudyLookupCacheRepository } from "../repositories/StudyLookupCacheRepository";
import { StudyLookupManager } from "../services/study/StudyLookupManager";
import type { StudyLanguage } from "../services/study/StudyLookupTypes";
import { StudyLookupPanel } from "./StudyLookupPanel";
import { LimaReaderEngine } from "../lima/LimaReaderEngine";
import type{LimaAnchor,LimaDocument}from"../lima/LimaDocument";import{BookNavigationHistory}from"../reader/navigation/BookNavigationHistory";import{NavigationPanel}from"./NavigationPanel";
import{StudyNotebookService}from"../reader/study/StudyNotebookService";import{StudyNotebookView}from"./StudyNotebookView";import type{StudyEntry}from"../reader/study/StudyNotebook";import{StudyEventBus}from"../reader/study/StudyEventBus";
import{ChapterStudySheetRepository}from"../repositories/ChapterStudySheetRepository";import{ChapterStudySheetService}from"../reader/study/ChapterStudySheetService";import{ChapterStudyController}from"../reader/study/ChapterStudyController";import{ChapterStudyView}from"./ChapterStudyView";
import{I18nManager}from"../i18n/I18nManager";import{ReaderInteractionController}from"../reader/interaction/ReaderInteractionController";
import{ReaderChromeController}from"../reader/premium/ReaderChromeController";import{FocusReadingMode}from"../reader/premium/FocusReadingMode";import{ReaderProgressModel}from"../reader/premium/ReaderProgressModel";import{ReaderProgressBar}from"./ReaderProgressBar";import{ReaderCoverPageView}from"./ReaderCoverPageView";
import{ImagePageTurnAnimator,type ImageTurnDirection}from"../reader/image/ImagePageTurnAnimator";
import{DesktopReaderStateMachine}from"../reader/desktop/DesktopReaderStateMachine";
import{ReaderPomodoroView}from"./ReaderPomodoroView";import{ReadingDayTracker}from"../reader/pomodoro/ReadingDayTracker";import{PomodoroSettingsController}from"../reader/settings/PomodoroSettingsController";import{StorageService}from"../services/StorageService";
import { ReadingReviewRepository } from "../repositories/ReadingReviewRepository";
import { ReadingReviewDialog } from "./ReadingReviewDialog";

export class ReaderView extends BaseView {
  private toolbar: ReaderToolbar | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private stage: HTMLElement | null = null;
  private settingsPanel: ReaderSettingsPanel | null = null;
  private currentPage = 1;
  private totalPages = 1;
  private touchStartX = 0;
  private touchStartY = 0;
  private controlsTimer = 0;
  private resizeTimer = 0;
  private reflow:ReflowReaderEngine|LimaReaderEngine|null=null;private reflowBook:Book|null=null;private turnController:PageTurnController|null=null;
  private desktopView:DesktopBookReaderView|null=null;
  private readonly highlights:HighlightManager;private readonly annotations:AnnotationManager;private readonly bookmarks:BookmarkManager;
  private readonly anchors=new ReadingAnchorService();private readonly selections=new TextSelectionManager();private readonly selectionMenu=new SelectionContextMenu();private readonly studyPanel=new StudyPanel();private selectedAnchor:TextAnchor|null=null;
  private readonly lookup:StudyLookupManager;private readonly lookupPanel=new StudyLookupPanel();private sourceLanguage:StudyLanguage="pt-BR";
  private readonly i18n=I18nManager.shared;private readonly interactions=new ReaderInteractionController();
  private stopLocaleWatch:()=>void=()=>undefined;
  private chrome:ReaderChromeController|null=null;private readonly focusMode=new FocusReadingMode();private progressBar:ReaderProgressBar|null=null;
  private limaDocument:LimaDocument|null=null;private navigationPanel:NavigationPanel|null=null;private readonly navigationHistory=new BookNavigationHistory();
  private readonly notebookService:StudyNotebookService;private notebookView:StudyNotebookView|null=null;private readonly annotationRepository:AnnotationRepository;
  private readonly chapterStudyController:ChapterStudyController;private chapterStudyView:ChapterStudyView|null=null;
  private readonly imageTurnAnimator=new ImagePageTurnAnimator();private imageTurnDirection:ImageTurnDirection|null=null;private imageTurnSnapshot:string|null=null;
  private readonly desktopState=new DesktopReaderStateMachine();
  private pomodoro:ReaderPomodoroView|null=null;private readonly readingDays=new ReadingDayTracker(new StorageService());
  private readonly reviews: ReadingReviewRepository;
  private imageBook: Book | null = null;
  private completionSequence: HTMLElement | null = null;
  private completionClosing = false;

  public constructor(private readonly bookId: string, private readonly manager: ReaderManager,
    private readonly globalTheme: "light" | "dark", private readonly onBack: () => void,
    private readonly onBookUpdated: (book: Book) => void, database:IndexedDbService, private readonly readerName?:string,
    private readonly readerUserId?:string) { super();const highlightRepository=new HighlightRepository(database),bookmarkRepository=new BookmarkRepository(database);this.annotationRepository=new AnnotationRepository(database);this.highlights=new HighlightManager(highlightRepository);this.annotations=new AnnotationManager(this.annotationRepository);this.bookmarks=new BookmarkManager(bookmarkRepository);this.notebookService=new StudyNotebookService(highlightRepository,this.annotationRepository,bookmarkRepository);this.lookup=new StudyLookupManager(new StudyLookupCacheRepository(database));this.chapterStudyController=new ChapterStudyController(new ChapterStudySheetService(new ChapterStudySheetRepository(database)),"current",bookId);this.reviews=new ReadingReviewRepository(database); }

  public render(): HTMLElement {
    const reader = this.createElement("section", "reader reader--controls-visible"); reader.dataset.readerTheme = this.globalTheme; reader.lang=this.i18n.locale;
    this.stage = this.createElement("div", "reader-stage"); this.stage.tabIndex = 0;
    this.canvas = this.createElement("canvas", "reader-page") as HTMLCanvasElement; this.canvas.setAttribute("aria-label", this.i18n.t("reader.pdfPage"));
    const loading = this.createElement("div", "reader-loading", this.i18n.t("reader.loading")); loading.setAttribute("role", "status");
    this.stage.append(this.canvas, loading, this.tapZones()); reader.append(this.stage);
    this.chrome=new ReaderChromeController(state=>{reader.classList.toggle("reader--controls-visible",state.visible);reader.classList.toggle("reader--focus-mode",state.focusMode);this.progressBar?.setVisible(state.progressVisible);});this.progressBar=new ReaderProgressBar();reader.append(this.progressBar.render());
    document.body.classList.add("reader-mode"); this.stopLocaleWatch=this.i18n.subscribe(locale=>{this.element?.setAttribute("lang",locale);this.settingsPanel?.refresh();}); queueMicrotask(() => void this.initialize()); return reader;
  }

  public override unmount(): void {
    window.clearTimeout(this.controlsTimer); window.clearTimeout(this.resizeTimer);
    document.removeEventListener("keydown", this.handleKeydown); window.removeEventListener("resize", this.handleResize);
    this.stopLocaleWatch();this.stopLocaleWatch=()=>undefined;this.chrome?.destroy();this.pomodoro?.destroy();this.pomodoro=null;document.body.classList.remove("reader-mode");this.notebookView?.destroy();this.chapterStudyView?.destroy();this.turnController?.unbind();this.desktopView?.destroy();void this.reflow?.close();void this.manager.close(); super.unmount();
  }

  private async initialize(): Promise<void> {
    if (!this.canvas || !this.stage || !this.element) return;
    try {
      await this.manager.settings.initialize(this.globalTheme); this.applyReaderSettings();
      const source=await this.manager.source(this.bookId);const savedProgress=source.progress?.progressPercent??source.book.progressPercent??0;const hasStartedReading=savedProgress>0;this.desktopState.restore(savedProgress);let reflow:ReflowReaderEngine|LimaReaderEngine;let type:"TEXT_BASED"|"MIXED"|"IMAGE_BASED"="TEXT_BASED";
      if(typeof document!=="undefined"&&document.fonts)await document.fonts.ready;const cover={title:source.book.title,author:source.book.author,image:source.book.cover||undefined};
      if(source.lima){this.limaDocument=source.lima;const engine=new LimaReaderEngine(),saved=source.progress?.currentLocation?.match(/^lima:([^:]+):(\d+)$/);engine.open(source.lima,this.paginationMetrics(),saved?.[1]?{blockId:saved[1],offset:Number(saved[2]??0)}:undefined,cover,!hasStartedReading);reflow=engine;}
      else{if(source.book.fileType==="epub")throw new EpubReaderUnavailableError("Este EPUB ainda está sendo preparado. Tente novamente em instantes.");const engine=new ReflowReaderEngine(),logical=source.progress?.currentLocation?.startsWith("logical:")?Number(source.progress.currentLocation.slice(8)):0;type=await engine.open(source.blob,this.paginationMetrics(),logical,cover,!hasStartedReading);reflow=engine;}
      if(type!=="IMAGE_BASED"){await this.manager.saveDocumentCapability(source.book,{documentMode:type==="MIXED"?"mixed":"native",textCapability:type==="MIXED"?"partial":"full",limaCapability:type==="MIXED"?"limited":"full"});this.reflow=reflow;this.reflowBook=source.book;await this.highlights.restore(source.book.id);this.mountReflow(source.book.title);this.remeasure();this.reflow.repaginate(this.paginationMetrics());
        /* The cover counts as page 1, so a save made on the cover or on the first page stores
         * a few tenths of a percent: shown as 0% on the shelf, yet it skipped the closed book.
         * Nothing past the first page has been read, so the book opens closed on its cover. */
        if(this.reflow.currentPageNumber<=2&&this.reflow.pageAt(1)?.cover){this.reflow.goTo(1);this.desktopState.restore(0);}
        this.renderReflow();return;}await reflow.close();await this.manager.saveDocumentCapability(source.book,{documentMode:"scanned",textCapability:"none",limaCapability:"unavailable"});
      this.element?.classList.add("reader--image-mode");this.stage.append(this.createElement("p","reader-image-mode-notice",this.i18n.t("reader.imageMode.notice")));
      const book = await this.manager.openImageReader(this.bookId, this.canvas, () => this.stageSize(), (incorrect) => this.requestPassword(incorrect),
        (state) => this.onPageRendered(state));
      this.imageBook = book;
      this.element.querySelector(".reader-loading")?.remove(); this.mountControls(book.title);
      document.addEventListener("keydown", this.handleKeydown); window.addEventListener("resize", this.handleResize); this.scheduleControlsHide();
    } catch (error) { this.showError(this.errorMessage(error)); }
  }
  private mountReflow(title:string):void{if(!this.stage||!this.element)return;this.stage.replaceChildren();this.stage.classList.add("reader-stage--reflow");this.stage.append(this.createElement("div","reflow-pages"),this.tapZones());this.element.querySelector(".reader-loading")?.remove();this.mountControls(title);document.addEventListener("keydown",this.handleKeydown);window.addEventListener("resize",this.handleResize);this.applyReflowStyles();this.scheduleControlsHide();}
  /** One page on a phone, an open spread on a wider screen. Asked here, in one place,
   *  so the three call sites cannot answer it differently. renderReflow() already runs
   *  again on resize, so crossing the breakpoint re-lays the reader out. */
  private wantsSpread():boolean{return this.manager.settings.preferencesService.preferences.pageLayout==="double"&&new ReaderLayoutPolicy().spreadFits(window);}
  private renderReflow():void{this.renderReflowPages();this.guardOverflow();}
  /** Last line of defence against type spilling off a page. If a visible page still
   *  overflows - a font that loaded late, a highlight that widened a line - the page box is
   *  shaved by one line and the book is cut again, keeping the reading position. Bounded,
   *  so a single block too tall for any page cannot loop. */
  private guardOverflow():void{if(!this.reflow||!this.stage)return;const pages=[...this.stage.querySelectorAll<HTMLElement>(".reflow-sheet--current:not(.reflow-sheet--cover),.open-book-page--left:not(.open-book-page--cover),.open-book-page--right:not(.open-book-page--cover)")];const spills=pages.some(page=>page.scrollHeight>page.clientHeight+1||page.scrollWidth>page.clientWidth+1);if(!spills){this.fitAttempts=0;return;}if(this.fitAttempts>=PageBoxMeasure.maxFitAttempts)return;this.fitAttempts++;this.fitSafety+=parseFloat(getComputedStyle(pages[0]!).lineHeight)||24;this.reflow.repaginate(this.paginationMetrics());this.renderReflowPages();this.guardOverflow();}
  private renderReflowPages():void{if(!this.reflow||!this.stage)return;const host=this.stage.querySelector<HTMLElement>(".reflow-pages");if(!host)return;this.turnController?.unbind();this.desktopView?.destroy();host.replaceChildren();const current=this.reflow.currentPageNumber;
    const doublePage=this.wantsSpread();
      const position=this.desktopPosition(),spread=new OpenBookNavigationController(this.reflow.totalPages+1).spreadStart(position);
      /* Positions 1-3 are the closed cover and the opened cover with page 1 on the right. */
      if(doublePage&&spread<=2&&this.reflow.pageAt(1)?.cover){const cover=this.reflow.pageAt(1)!,next=this.reflow.pageAt(2),name=this.readerName?.trim(),heading=name?this.i18n.t("ui.greeting.hello",{name}):this.i18n.t("ui.greeting.readerHello");this.desktopView=new DesktopBookReaderView(cover,next,()=>void this.previous(),()=>void this.next(),paragraph=>this.renderParagraph(paragraph),{versoAfter:this.reflow.pageAt(3),underAfter:this.reflow.pageAt(4),versoBefore:null,underBefore:null},{coverState:spread===0?"closed":"open",greeting:{heading,copy:this.i18n.t("ui.greeting.readerDeskCopy")},onCoverOpen:()=>this.openDesktopCover(),onCoverClose:()=>this.closeDesktopCover(),onTurnStart:direction=>this.desktopState.beginDrag(direction),onTurnSettling:direction=>this.desktopState.beginSettling(direction),onTurnFinished:()=>this.desktopState.settle()});host.append(this.desktopView.render());this.bindSelection(host);this.currentPage=current;this.totalPages=this.reflow.totalPages;this.toolbar?.update(this.currentPage,this.totalPages,this.manager.settings.settings.fontSize);this.updateCurrentChapter();this.updateProgress();return;}
    if(doublePage){const navigation=new OpenBookNavigationController(this.reflow.totalPages+1),start=spread;const at=(position:number)=>position>=2?this.reflow!.pageAt(position-1):null;this.desktopView=new DesktopBookReaderView(at(start),at(start+1),()=>void this.moveDesktop(navigation.previous(position)),()=>void this.moveDesktop(navigation.next(position)),paragraph=>this.renderParagraph(paragraph),{versoAfter:at(start+2),underAfter:at(start+3),versoBefore:at(start-1),underBefore:at(start-2)});host.append(this.desktopView.render());this.bindSelection(host);this.currentPage=Math.max(1,start-1);this.totalPages=this.reflow.totalPages;this.toolbar?.update(this.currentPage,this.totalPages,this.manager.settings.settings.fontSize);this.updateCurrentChapter();return;}
    this.reflow.window().forEach(page=>{const sheet=this.createElement("article",`reflow-sheet${page.cover?" reflow-sheet--cover":""}${page.index+1===current?" reflow-sheet--current":""}`);sheet.dataset.page=String(page.index+1);if(page.cover)sheet.append(this.renderCover(page.cover));else{page.paragraphs.forEach(paragraph=>sheet.append(this.renderParagraph(paragraph)));sheet.append(this.reflowPageNumber(page));if(page.index+1===current)sheet.append(this.reflowVerso(this.reflow!.pageAt(current+1)));}host.append(sheet);});this.bindSelection(host);
    const active=host.querySelector<HTMLElement>(".reflow-sheet--current");if(active&&this.manager.settings.settings.animation==="page-turn"){this.turnController=new PageTurnController(active,()=>void this.next(),()=>void this.previous());this.turnController.bind();}
    this.currentPage=this.reflow.currentPageNumber;this.totalPages=this.reflow.totalPages;this.toolbar?.update(this.currentPage,this.totalPages,this.manager.settings.settings.fontSize);this.updateCurrentChapter();this.updateProgress();}
  private openDesktopCover():void{if(!this.desktopState.beginOpening())return;this.desktopState.opened();this.renderReflow();}
  private closeDesktopCover():void{if(!this.desktopState.beginClosing())return;this.desktopState.closed();this.renderReflow();}
  /** Desktop positions count the physical book: 1 is the closed cover, 2 its lining with
   *  page 1 beside it, and from there every page sits one place later than its number.
   *  Spreads then pair exactly the leaves a turn has just shown, from the cover onwards. */
  private desktopPosition():number{const page=this.reflow?.currentPageNumber??1;return page===1?(this.desktopState.isClosed?1:2):page+1;}
  private async moveDesktop(position:number):Promise<void>{
    if(!this.reflow)return;
    if(position===this.desktopPosition()){
      if(this.reflow.currentPageNumber>=this.reflow.totalPages)await this.beginCompletionSequence();
      return;
    }
    if(position<=1)this.desktopState.restore(0);else this.desktopState.forceOpen();
    const forward=position>this.desktopPosition();
    this.reflow.goTo(Math.min(this.reflow.totalPages,Math.max(1,position-1)));
    this.renderReflow();
    // A spread brings two pages into view at once; both count towards today's pages.
    if(forward){const first=this.reflow.currentPageNumber;void this.pomodoro?.pagesViewed(this.bookId,[first,first+1].filter(page=>page<=this.reflow!.totalPages));}await this.saveReflow(this.reflow.currentPageNumber>=this.reflow.totalPages);
  }
  private async saveReflow(reachedEnd=false):Promise<void>{if(!this.reflow||!this.reflowBook)return;const anchor=this.reflow.readingAnchor,location=this.reflow instanceof LimaReaderEngine?`lima:${anchor.paragraphId}:${anchor.textOffset}`:undefined;this.reflowBook=await this.manager.saveReflow(this.reflowBook,this.reflow.currentPageNumber,this.reflow.totalPages,anchor.logicalOffset,reachedEnd,location);this.onBookUpdated(this.reflowBook);}

  /** The review is the book's final spread: it is only mounted after the reader
   * deliberately turns past the last content leaf, never when that leaf first renders. */
  private async beginCompletionSequence(): Promise<void> {
    if (this.completionSequence || this.completionClosing || !this.stage) return;
    if (this.reflow) await this.saveReflow(true);
    const book = this.reflowBook ?? this.imageBook;
    if (!book) return;
    const sequence = this.createElement("section", "reader-completion-sequence");
    sequence.setAttribute("aria-label", this.i18n.t("reader.review.title"));
    const closingBook = this.createElement("div", "reader-completion-book");
    const back = this.createElement("div", "reader-completion-back");
    back.setAttribute("aria-hidden", "true");
    const finalPage = this.createElement("div", "reader-completion-page");
    if (this.readerUserId) {
      finalPage.append(new ReadingReviewDialog(async (rating, comment) => {
        await this.reviews.save({ userId:this.readerUserId!, bookId:book.id, rating, comment:comment || undefined });
        // App-level persistence mirrors review metadata to the current account.
        this.onBookUpdated(book);
      }).renderEmbedded(() => this.closeCompletionSequence()));
    } else {
      const closing = this.createElement("button", "reader-completion-close", this.i18n.t("ui.common.close"));
      closing.type = "button"; closing.addEventListener("click", () => this.closeCompletionSequence());
      finalPage.append(closing);
    }
    closingBook.append(back, finalPage); sequence.append(closingBook); this.stage.append(sequence);
    this.completionSequence = sequence;
    sequence.querySelector<HTMLElement>("button, textarea")?.focus();
  }

  private closeCompletionSequence(): void {
    if (!this.completionSequence || this.completionClosing) return;
    this.completionClosing = true; this.completionSequence.classList.add("reader-completion-sequence--closing");
    window.setTimeout(() => this.onBack(), 520);
  }

  private mountControls(title: string): void {
    if (!this.element) return;
    const actions: ReaderToolbarActions = {
      back: this.onBack, previous: () => void this.previous(), next: () => void this.next(), pagePicker: () => this.showPageDialog(),
      toggleSettings: () => this.toggleSettings(), zoomIn: () => void this.changeZoom("in"), zoomOut: () => void this.changeZoom("out"),
      fitWidth: () => void this.fit("width"), fitPage: () => void this.fit("page"),
      bookmark:()=>void this.createBookmark(),toggleStudy:()=>void this.openStudyPanel(),
      toggleNavigation:()=>void this.toggleNavigation(),
      toggleNotebook:()=>void this.toggleNotebook(),
    };
    this.toolbar = new ReaderToolbar(title, actions); this.element.append(this.toolbar.render());
    const service=this.manager.settings.preferencesService;
    this.settingsPanel = new ReaderSettingsPanel(() => service.preferences, Boolean(this.reflow),
      new FontSettingsController(service), new PaperSettingsController(service), new LayoutSettingsController(service),
      new AnimationSettingsController(service), new ImageSettingsController(service), (repaginate) => void this.applyPreferences(repaginate), (open) => this.toolbar?.setSettingsOpen(open),
      { controller: new PomodoroSettingsController(service), today: () => this.readingDays.today() });
    this.pomodoro?.destroy(); this.pomodoro = new ReaderPomodoroView(this.readingDays, () => service.preferences, this.onBack); this.pomodoro.mount(this.element);
    this.element.append(this.settingsPanel.render(),this.studyPanel.render(),this.lookupPanel.render());if(this.limaDocument){this.navigationPanel=new NavigationPanel(this.limaDocument,()=>this.currentLimaAnchor(),()=>this.navigationStudyData(),(anchor,focus)=>this.navigateToAnchor(anchor,focus),()=>this.navigationBack());this.notebookView=new StudyNotebookView(this.bookId,this.limaDocument,this.notebookService,entry=>this.navigateNotebookEntry(entry),entry=>void this.editNotebookEntry(entry),entry=>void this.deleteNotebookEntry(entry));this.chapterStudyView=new ChapterStudyView(this.chapterStudyController,async chapterId=>(await this.notebookService.load(this.bookId,this.limaDocument!)).entries.filter(entry=>entry.chapterId===chapterId),(anchor,text)=>{this.chapterStudyView?.close();this.navigateToAnchor(anchor,text)});const notebookElement=this.notebookView.render(),sheetElement=this.chapterStudyView.render(),openSheet=this.createElement("button","chapter-study-open","Abrir fichário");openSheet.type="button";openSheet.addEventListener("click",()=>{const chapter=this.currentChapter();if(chapter){this.notebookView?.close();void this.chapterStudyView?.open(chapter);}});notebookElement.querySelector("header")?.append(openSheet);this.element.append(this.navigationPanel.render(),notebookElement,sheetElement);}
    this.toolbar.update(this.currentPage, this.totalPages, this.manager.settings.settings.zoom);this.chrome?.show(true);this.showResumeHint();
  }

  private onPageRendered(state: ReaderPageState): void {
    this.currentPage = state.currentPage; this.totalPages = state.totalPages; this.imageBook = state.book; this.onBookUpdated(state.book);
    this.toolbar?.update(state.currentPage, state.totalPages, this.manager.settings.settings.zoom);
    this.updateProgress();
    if (state.reason === "next") void this.pomodoro?.pagesViewed(this.bookId, [state.currentPage]);
    if (this.imageTurnDirection && this.manager.settings.settings.animation === "page-turn" && this.canvas) this.imageTurnAnimator.play(this.canvas, this.imageTurnDirection, this.imageTurnSnapshot);
    else if (state.reason !== "initial") this.animatePage(state.reason === "previous" ? "previous" : "next");
    this.imageTurnDirection = null; this.imageTurnSnapshot = null; this.showControls();
  }

  private tapZones(): HTMLElement {
    const zones = this.createElement("div", "reader-tap-zones");
    zones.append(this.zone("reader-tap-zone--previous", this.i18n.t("reader.previousPage"), () => void this.previous()),
      this.zone("reader-tap-zone--center", this.i18n.t("reader.toggleControls"), () => undefined),
      this.zone("reader-tap-zone--next", this.i18n.t("reader.nextPage"), () => void this.next()));
    zones.addEventListener("touchstart", (event) => { const touch = event.changedTouches[0]; if (touch) { this.touchStartX = touch.clientX; this.touchStartY = touch.clientY; this.interactions.begin({x:touch.clientX,y:touch.clientY,time:event.timeStamp,target:"content"}); } }, { passive: true });
    zones.addEventListener("touchend", (event) => this.handleSwipe(event), { passive: true }); return zones;
  }

  private zone(className: string, label: string, action: () => void): HTMLButtonElement {
    const zone = this.createElement("button", `reader-tap-zone ${className}`); zone.type = "button"; zone.setAttribute("aria-label", label); zone.addEventListener("click", () => { if(!this.interactions.consumeSuppressedClick()) action(); }); return zone;
  }

  private async next(): Promise<void> {
    if(this.completionSequence)return;
    if(this.reflow){
      if(this.reflow.currentPageNumber>=this.reflow.totalPages){await this.beginCompletionSequence();return;}
      if(this.wantsSpread()){const navigation=new OpenBookNavigationController(this.reflow.totalPages+1);await this.moveDesktop(navigation.next(this.desktopPosition()));return;}
      const moved=this.reflow.next();if(moved){this.renderReflow();void this.pomodoro?.pagesViewed(this.bookId,[this.reflow.currentPageNumber]);await this.saveReflow(this.reflow.currentPageNumber===this.reflow.totalPages);}return;
    }
    if(this.manager.navigation&&this.manager.navigation.currentPage>=this.manager.navigation.totalPages){await this.beginCompletionSequence();return;}
    this.prepareImageTurn("next");await this.manager.navigation?.nextPage();
  }
  private async previous(): Promise<void> { if(this.reflow){if(this.wantsSpread()){const navigation=new OpenBookNavigationController(this.reflow.totalPages+1);await this.moveDesktop(navigation.previous(this.desktopPosition()));return;}if(this.reflow.previous()){this.renderReflow();await this.saveReflow();}return;}this.prepareImageTurn("previous");await this.manager.navigation?.previousPage(); }
  private handleSwipe(event: TouchEvent): void {
    const touch = event.changedTouches[0]; if (!touch) return;
    const deltaX = touch.clientX - this.touchStartX; const deltaY = touch.clientY - this.touchStartY;
    const intent=this.interactions.end({x:touch.clientX,y:touch.clientY,time:event.timeStamp,target:"content"});
    if (intent!=="SWIPE"||Math.abs(deltaX) < 55 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    deltaX < 0 ? void this.next() : void this.previous();
  }

  /** Pages are cut to the box a real page gets from the stylesheet - half the spread on a
   *  wide screen, the whole sheet on a phone - with words measured in the real font.
   *  The estimate remains only for when nothing is laid out yet. */
  private fitSafety=0;private fitAttempts=0;
  private paginationMetrics():PaginationMetrics{const settings=this.manager.settings.settings;const base={width:Math.min(this.stage?.clientWidth??window.innerWidth,settings.readingWidth+settings.margins*2),height:this.stage?.clientHeight??window.innerHeight,fontSize:settings.fontSize,lineHeight:settings.lineHeight,margin:settings.margins};const measured=this.element?PageBoxMeasure.measure(this.element,this.wantsSpread(),this.fitSafety):null;return measured?{...base,...measured}:base;}
  private remeasure():void{this.fitSafety=0;this.fitAttempts=0;}
  private async updateReflow(settings:Parameters<ReaderManager["settings"]["updateReflow"]>[0]):Promise<void>{await this.manager.settings.updateReflow(settings);if(settings.textColor&&this.element)this.element.style.setProperty("--reader-custom-ink",settings.textColor);if(!this.reflow)return;this.applyReflowStyles();this.remeasure();this.reflow.repaginate(this.paginationMetrics());this.renderReflow();await this.saveReflow();}
  private applyReflowStyles():void{if(!this.element)return;const settings=this.manager.settings.settings;this.element.dataset.paper=this.manager.settings.preferencesService.preferences.paperTheme;this.element.style.setProperty("--reflow-font-size",`${settings.fontSize}px`);this.element.style.setProperty("--reflow-font-weight",String(settings.fontWeight));this.element.style.setProperty("--reflow-line-height",String(settings.lineHeight));this.element.style.setProperty("--reflow-paragraph-gap",`${settings.paragraphSpacing}em`);this.element.style.setProperty("--reflow-margin",`${settings.margins}px`);this.element.style.setProperty("--reflow-width",`${settings.readingWidth}px`);this.element.style.setProperty("--reflow-align",settings.alignment);this.element.dataset.font=settings.fontFamily;}
  private async applyPreferences(repaginate:boolean):Promise<void>{this.manager.settings.syncPreferences();this.pomodoro?.sync();this.applyReaderSettings();this.applyReflowStyles();if(this.reflow&&repaginate){this.remeasure();this.reflow.repaginate(this.paginationMetrics());}if(this.reflow)this.renderReflow();else await this.manager.rerender();await this.saveReflow();}
  private renderParagraph(paragraph:ReaderParagraph):HTMLElement{const element=this.createElement(paragraph.kind==="heading"?"h2":"p",`reader-${paragraph.kind}`);const blockId=paragraph.sourceBlockId??paragraph.id,start=paragraph.sourceStart??0,end=start+paragraph.text.length;element.dataset.blockId=blockId;element.dataset.sourceStart=String(start);const marks=this.highlights.forBlock(blockId).filter(mark=>mark.endOffset>start&&mark.startOffset<end).sort((a,b)=>a.startOffset-b.startOffset);let cursor=start;marks.forEach(mark=>{const from=Math.max(start,mark.startOffset),to=Math.min(end,mark.endOffset);if(from>cursor)element.append(document.createTextNode(paragraph.text.slice(cursor-start,from-start)));const highlighted=document.createElement("mark");highlighted.className=`reader-highlight reader-highlight--${mark.color}`;highlighted.dataset.highlightId=mark.id;highlighted.textContent=paragraph.text.slice(from-start,to-start);element.append(highlighted);cursor=Math.max(cursor,to);});if(cursor<end)element.append(document.createTextNode(paragraph.text.slice(cursor-start)));return element;}
  private renderCover(cover:ReaderCoverPage):HTMLElement{return new ReaderCoverPageView().render(cover);}
  private reflowPageNumber(page:ReaderPage):HTMLElement{return this.createElement("span","reflow-sheet__number",page.visualLabel??String(page.index+1));}
  private reflowVerso(page:ReaderPage|null):HTMLElement{const face=this.createElement("div","page-turn-verso");face.setAttribute("aria-hidden","true");if(!page||page.cover)return face;const content=this.createElement("div","reflow-sheet__verso-content");page.paragraphs.forEach(paragraph=>content.append(this.renderParagraph(paragraph)));content.append(this.reflowPageNumber(page));face.append(content);return face;}
  private bindSelection(root:HTMLElement):void{root.addEventListener("pointerdown",event=>{this.chrome?.selectionStarted();this.interactions.begin({x:event.clientX,y:event.clientY,time:event.timeStamp,target:"content"})});root.addEventListener("pointerup",event=>{window.setTimeout(()=>{const anchor=this.selections.selection(root),intent=this.interactions.end({x:event.clientX,y:event.clientY,time:event.timeStamp,target:"content",hasSelection:Boolean(anchor)});if(intent==="TAP"||intent==="SWIPE"||!anchor)return;this.selectedAnchor=anchor;const range=window.getSelection()?.getRangeAt(0);if(range)this.selectionMenu.open(range.getBoundingClientRect(),{highlight:color=>void this.createHighlight(color),annotate:()=>void this.createAnnotation(),definition:()=>void this.showDefinition(),translate:()=>this.chooseTranslation(),search:()=>this.webSearch(),origin:()=>void this.showOrigin(),context:()=>this.showContext(),copy:()=>void this.copySelection(),bookmark:()=>void this.bookmarkSelection(),paragraph:()=>this.selectParagraph(root),addToSheet:()=>void this.addSelectionToSheet()});},0)});}
  private async showDefinition():Promise<void>{const text=this.selectedAnchor?.selectedText;if(!text)return;this.lookupPanel.loading("Buscando significado…");try{this.lookupPanel.definition(await this.lookup.definition(text,this.sourceLanguage));}catch(error){this.lookupPanel.error(this.lookupMessage(error),()=>void this.showDefinition());}}
  private chooseTranslation():void{if(!this.selectedAnchor)return;this.lookupPanel.languagePicker(this.sourceLanguage==="en"?"pt-BR":"en",language=>void this.showTranslation(language));}
  private async showTranslation(target:StudyLanguage):Promise<void>{const text=this.selectedAnchor?.selectedText;if(!text)return;this.lookupPanel.loading("Traduzindo…");try{this.lookupPanel.translation(await this.lookup.translate(text,this.sourceLanguage,target));}catch(error){this.lookupPanel.error(this.lookupMessage(error),()=>void this.showTranslation(target));}}
  private showContext():void{const anchor=this.selectedAnchor;if(!anchor||!this.reflow)return;const paragraphs=this.reflow.allPages.flatMap(page=>page.paragraphs);this.lookupPanel.context(this.lookup.localContext(anchor.blockId,paragraphs));}
  private async showOrigin():Promise<void>{const text=this.selectedAnchor?.selectedText;if(!text)return;this.lookupPanel.loading("Buscando origem…");try{this.lookupPanel.origin(await this.lookup.wordOrigin(text,this.sourceLanguage));}catch(error){this.lookupPanel.error(this.lookupMessage(error),()=>void this.showOrigin());}}
  private webSearch():void{if(!this.selectedAnchor)return;try{this.lookup.webSearch(this.selectedAnchor.selectedText);}catch(error){this.lookupPanel.error(this.lookupMessage(error),()=>this.webSearch());}}
  private lookupMessage(error:unknown):string{return error instanceof Error?error.message:"Não foi possível concluir a consulta. Tente novamente.";}
  private async createHighlight(color:HighlightColor):Promise<Highlight|null>{if(!this.selectedAnchor||!this.reflowBook)return null;const value=await this.highlights.create(this.reflowBook.id,this.selectedAnchor,color);StudyEventBus.shared.publish({bookId:this.reflowBook.id,type:"created"});this.selectedAnchor=null;this.selections.clear();this.renderReflow();return value;}
  private async createAnnotation():Promise<void>{const anchor=this.selectedAnchor,book=this.reflowBook;if(!anchor||!book)return;const input=this.createElement("input","input") as HTMLInputElement;input.placeholder="Por que você marcou este trecho?";this.showDialog("Adicionar nota",input,"Salvar",async()=>{const text=input.value.trim();if(!text)return;const highlight=await this.highlights.create(book.id,anchor,"yellow");await this.annotations.create(book.id,highlight.id,text);StudyEventBus.shared.publish({bookId:book.id,type:"created"});this.selectedAnchor=null;this.selections.clear();this.renderReflow();});}
  private async copySelection():Promise<void>{if(!this.selectedAnchor)return;try{await navigator.clipboard.writeText(this.selectedAnchor.selectedText);}catch{const area=document.createElement("textarea");area.value=this.selectedAnchor.selectedText;document.body.append(area);area.select();document.execCommand("copy");area.remove();}this.selections.clear();}
  private async bookmarkSelection():Promise<void>{if(!this.selectedAnchor||!this.reflowBook||!this.reflow)return;const page=this.anchors.pageFor({paragraphId:this.selectedAnchor.blockId,textOffset:this.selectedAnchor.startOffset,logicalOffset:0},this.reflow.allPages);this.reflow.goTo(page);await this.bookmarks.create(this.reflowBook.id,{paragraphId:this.selectedAnchor.blockId,textOffset:this.selectedAnchor.startOffset,logicalOffset:this.reflow.readingAnchor.logicalOffset},this.selectedAnchor.selectedText.slice(0,60));StudyEventBus.shared.publish({bookId:this.reflowBook.id,type:"created"});this.selections.clear();}
  private selectParagraph(root:HTMLElement):void{const anchor=this.selections.paragraph(root);if(!anchor)return;this.selectedAnchor=anchor;const block=root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(anchor.blockId)}"]`);if(block){const range=document.createRange();range.selectNodeContents(block);const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);}}
  private async createBookmark():Promise<void>{if(!this.reflow||!this.reflowBook)return;await this.bookmarks.create(this.reflowBook.id,this.reflow.readingAnchor,`Página ${this.reflow.currentPageNumber}`);StudyEventBus.shared.publish({bookId:this.reflowBook.id,type:"created"});}
  private async openStudyPanel():Promise<void>{if(this.studyPanel.isOpen){this.studyPanel.close();return;}if(!this.reflowBook)return;const [highlights,annotations,bookmarks]=await Promise.all([this.highlights.restore(this.reflowBook.id),this.annotations.list(this.reflowBook.id),this.bookmarks.list(this.reflowBook.id)]);this.studyPanel.show(highlights,annotations,bookmarks,item=>void this.navigateStudyItem(item),(kind,id)=>void this.removeStudyItem(kind,id),note=>this.editAnnotation(note));}
  private editAnnotation(annotation:import("../models/Annotation").AnnotationData):void{const input=this.createElement("input","input") as HTMLInputElement;input.value=annotation.text;input.placeholder="Por que você marcou este trecho?";this.showDialog("Editar nota",input,"Salvar",async()=>{if(input.value.trim())await this.annotations.edit(annotation,input.value);await this.openStudyPanel();});}
  private async navigateStudyItem(item:Highlight|BookmarkData):Promise<void>{if(!this.reflow)return;const anchor="selectedText"in item?this.anchors.forHighlight(item,this.reflow.allPages):item.anchor;this.reflow.goTo(this.anchors.pageFor(anchor,this.reflow.allPages));this.studyPanel.close();this.renderReflow();window.setTimeout(()=>this.element?.querySelector<HTMLElement>(".reader-highlight")?.classList.add("reader-highlight--focus"),0);await this.saveReflow();}
  private async removeStudyItem(kind:"highlight"|"annotation"|"bookmark",id:string):Promise<void>{if(kind==="highlight"){const note=await this.annotations.forHighlight(id);if(note)await this.annotations.delete(note.id);await this.highlights.delete(id);}else if(kind==="annotation")await this.annotations.delete(id);else await this.bookmarks.delete(id);if(this.reflowBook)StudyEventBus.shared.publish({bookId:this.reflowBook.id,type:"deleted"});this.renderReflow();await this.openStudyPanel();}
  private toggleNavigation(section:import("./NavigationPanel").NavigationSection="toc"):void{if(!this.navigationPanel)return;if(this.navigationPanel.isOpen)this.navigationPanel.close();else void this.navigationPanel.open(section);}
  private currentLimaAnchor():LimaAnchor{const anchor=this.reflow?.readingAnchor;return{blockId:anchor?.paragraphId??this.limaDocument?.blocks[0]?.id??"p-0",offset:anchor?.textOffset??0};}
  private async navigationStudyData():Promise<{highlights:import("../models/Highlight").HighlightData[];annotations:import("../models/Annotation").AnnotationData[];bookmarks:BookmarkData[]}>{if(!this.reflowBook)return{highlights:[],annotations:[],bookmarks:[]};const[highlights,annotations,bookmarks]=await Promise.all([this.highlights.restore(this.reflowBook.id),this.annotations.list(this.reflowBook.id),this.bookmarks.list(this.reflowBook.id)]);return{highlights,annotations,bookmarks};}
  private navigateToAnchor(anchor:LimaAnchor,focusText?:string):void{if(!(this.reflow instanceof LimaReaderEngine))return;this.navigationHistory.push(this.currentLimaAnchor());this.reflow.goToAnchor(anchor);this.navigationPanel?.close();this.renderReflow();window.setTimeout(()=>{const block=this.element?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(anchor.blockId)}"]`);if(block){block.classList.add("reader-navigation-focus");if(focusText)block.dataset.navigationMatch=focusText;}},0);}
  private navigationBack():void{const anchor=this.navigationHistory.back();if(!anchor||!(this.reflow instanceof LimaReaderEngine))return;this.reflow.goToAnchor(anchor);this.navigationPanel?.close();this.renderReflow();}
  private updateCurrentChapter():void{if(!this.limaDocument)return;const anchor=this.currentLimaAnchor(),block=this.limaDocument.blocks.find(value=>value.id===anchor.blockId),chapter=this.limaDocument.chapters.find(value=>value.id===block?.chapterId);this.toolbar?.setChapter(chapter?.title.trim()||this.limaDocument.metadata.title);}
  private currentChapter(){if(!this.limaDocument)return null;const block=this.limaDocument.blocks.find(value=>value.id===this.currentLimaAnchor().blockId);return this.limaDocument.chapters.find(value=>value.id===block?.chapterId)??null;}
  private async addSelectionToSheet():Promise<void>{const selected=this.selectedAnchor,chapter=this.currentChapter();if(!selected||!chapter||!this.chapterStudyView)return;await this.chapterStudyView.open(chapter);const choice=window.prompt("Adicionar como: 1 tópico, 2 pergunta ou 3 dúvida","1");const kind=choice==="2"?"question":choice==="3"?"doubt":"topic";this.chapterStudyView.addSelection(kind,{blockId:selected.blockId,offset:selected.startOffset},selected.selectedText);this.selections.clear();}
  private toggleNotebook():void{if(!this.notebookView)return;if(this.notebookView.isOpen)this.notebookView.close();else void this.notebookView.open();}
  private navigateNotebookEntry(entry:StudyEntry):void{this.notebookView?.close();this.navigateToAnchor(entry.anchor,entry.selectedText);}
  private async editNotebookEntry(entry:StudyEntry):Promise<void>{const annotation=await this.annotationRepository.get(entry.sourceId);if(!annotation)return;const input=this.createElement("input","input")as HTMLInputElement;input.value=annotation.text;input.placeholder="Por que você marcou este trecho?";this.showDialog("Editar nota",input,"Salvar",async()=>{if(input.value.trim()){await this.annotations.edit(annotation,input.value);StudyEventBus.shared.publish({bookId:entry.bookId,type:"updated"});}});}
  private async deleteNotebookEntry(entry:StudyEntry):Promise<void>{await this.removeStudyItem(entry.type,entry.sourceId);}
  private toggleSettings(): void {
    if (!this.settingsPanel) return; this.settingsPanel.toggle();
  }

  private async changeZoom(direction: "in" | "out"): Promise<void> {
    if(this.reflow){await this.updateReflow({fontSize:this.manager.settings.settings.fontSize+(direction==="in"?2:-2)});return;}
    direction === "in" ? await this.manager.settings.zoomIn() : await this.manager.settings.zoomOut(); await this.manager.rerender();
    this.toolbar?.update(this.currentPage, this.totalPages, this.manager.settings.settings.zoom);
  }
  private async fit(mode: "width" | "page"): Promise<void> {
    if(this.reflow){await this.updateReflow({readingWidth:mode==="width"?900:620});return;}
    mode === "width" ? await this.manager.settings.fitWidth() : await this.manager.settings.fitPage(); await this.manager.rerender();
  }
  private applyReaderSettings(): void {
    if (!this.element || !this.stage) return; this.element.dataset.readerTheme = this.manager.settings.settings.theme;
    const preferences=this.manager.settings.preferencesService.preferences;this.element.dataset.readingMode=preferences.readingMode;this.element.dataset.paper=preferences.paperTheme;
    const paperLightness=Math.round(45+this.manager.settings.settings.brightness*.55);
    this.element.style.setProperty("--reader-lightness",`${paperLightness}%`);
  }

  private showPageDialog(): void {
    const input = this.createElement("input", "input") as HTMLInputElement; input.type = "number"; input.min = "1"; input.max = String(this.totalPages); input.value = String(this.currentPage);
    this.showDialog("Ir para página", input, "Ir", async () => { if(this.reflow){this.reflow.goTo(Number(input.value));this.renderReflow();await this.saveReflow();}else await this.manager.navigation?.goToPage(Number(input.value)); });
  }
  private requestPassword(incorrect: boolean): Promise<string | null> {
    return new Promise((resolve) => {
      const input = this.createElement("input", "input") as HTMLInputElement; input.type = "password"; input.autocomplete = "off";
      this.showDialog(incorrect ? "Senha incorreta. Tente novamente" : "Este PDF é protegido por senha", input, "Abrir", () => resolve(input.value), () => resolve(null));
    });
  }
  private showDialog(title: string, input: HTMLInputElement, actionLabel: string, action: () => void | Promise<void>, cancelAction: () => void = () => undefined): void {
    if (!this.element) return; const layer = this.createElement("div", "reader-dialog-layer"); const dialog = this.createElement("form", "reader-dialog");
    dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true"); dialog.append(this.createElement("h2", "section-title", title), input);
    const error = this.createElement("p", "form-error"); const actions = this.createElement("div", "form-actions");
    const confirm = this.createElement("button", "button button--primary", actionLabel); confirm.type = "submit";
    const cancel = this.createElement("button", "button button--secondary", "Cancelar"); cancel.type = "button"; actions.append(confirm, cancel); dialog.append(error, actions); layer.append(dialog); this.element.append(layer);
    const close = (): void => { layer.remove(); this.stage?.focus(); };
    cancel.addEventListener("click", () => { cancelAction(); close(); });
    layer.addEventListener("click", (event) => { if (event.target === layer) { cancelAction(); close(); } });
    dialog.addEventListener("submit", async (event) => { event.preventDefault(); try { await action(); close(); } catch (caught) { error.textContent = caught instanceof Error ? caught.message : "Valor inválido."; } });
    input.focus();
  }

  private showError(message: string): void {
    if (!this.element) return; this.element.replaceChildren(); const error = this.createElement("div", "reader-error");
    error.append(this.createElement("h1", "section-title", "Não foi possível abrir o livro"), this.createElement("p", undefined, message));
    const back = this.createElement("button", "button button--primary", "Voltar para biblioteca"); back.type = "button"; back.addEventListener("click", this.onBack); error.append(back); this.element.append(error);
  }
  private errorMessage(error: unknown): string {
    if (error instanceof EpubReaderUnavailableError || error instanceof ReaderFileMissingError) return error.message;
    if (error instanceof PdfPasswordCancelledError) return error.message;
    if (error instanceof Error && /password/i.test(error.message)) return "Não foi possível abrir o PDF com essa senha.";
    return "O PDF parece inválido ou corrompido. Tente importá-lo novamente.";
  }

  private animatePage(direction: "next" | "previous"): void {
    if (!this.canvas) return; const animation = this.manager.settings.settings.animation; if (animation === "carousel") return;
    this.canvas.classList.remove("reader-page--slide-next", "reader-page--slide-previous", "reader-page--turn-next", "reader-page--turn-previous");
    void this.canvas.offsetWidth; this.canvas.classList.add(`reader-page--${animation === "slide" ? "slide" : "turn"}-${direction}`);
  }
  private prepareImageTurn(direction: ImageTurnDirection): void {
    if (!this.canvas || !this.manager.navigation) return;
    const atStart = direction === "previous" && this.manager.navigation.currentPage <= 1;
    const atEnd = direction === "next" && this.manager.navigation.currentPage >= this.manager.navigation.totalPages;
    this.imageTurnDirection = atStart || atEnd ? null : direction;
    this.imageTurnSnapshot = this.imageTurnDirection ? this.imageTurnAnimator.capture(this.canvas) : null;
  }
  private showControls(): void { this.chrome?.show(!this.settingsPanel?.isOpen); }
  private scheduleControlsHide(): void { this.chrome?.schedule(); }
  private updateProgress():void{this.progressBar?.update(new ReaderProgressModel().build(this.currentPage,this.totalPages,this.currentChapter()?.title));}
  private showResumeHint():void{if(this.currentPage<=1||!this.element)return;const hint=this.createElement("p","reader-resume-hint",this.i18n.t("reader.resume.continuing"));this.element.append(hint);window.setTimeout(()=>hint.remove(),2200);}
  private stageSize(): { width: number; height: number } { return { width: this.stage?.clientWidth ?? window.innerWidth, height: this.stage?.clientHeight ?? window.innerHeight }; }
  private readonly handleResize = (): void => { window.clearTimeout(this.resizeTimer); this.resizeTimer = window.setTimeout(() => {if(this.reflow){this.remeasure();this.reflow.repaginate(this.paginationMetrics());this.renderReflow();}else void this.manager.rerender();}, 180); };
  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if((event.ctrlKey||event.metaKey)&&event.key.toLocaleLowerCase()==="f"&&this.navigationPanel){event.preventDefault();void this.navigationPanel.open("search");return;}
    const target=event.target as HTMLElement|null;if(target?.closest("input,textarea,select,[contenteditable=true]"))return;
    if (event.key === "ArrowLeft"||event.key===" "&&event.shiftKey) this.desktopView?void this.desktopView.turn(-1):this.turnController?void this.turnController.turn(-1):void this.previous(); if (event.key === "ArrowRight"||event.key===" ") this.desktopView?void this.desktopView.turn(1):this.turnController?void this.turnController.turn(1):void this.next();
    if(event.key.toLocaleLowerCase()==="f"){event.preventDefault();this.chrome?.setFocusMode(this.focusMode.toggle());}
    if(event.key.toLocaleLowerCase()==="g"){event.preventDefault();this.toggleSettings();}
    if(event.key.toLocaleLowerCase()==="t"&&this.navigationPanel){event.preventDefault();void this.navigationPanel.open("toc");}
    if (event.key === "Escape") {
      const dialog = this.element?.querySelector<HTMLElement>(".reader-dialog-layer"); if (dialog) dialog.querySelector<HTMLButtonElement>("button[type=button]")?.click();
      else if(this.notebookView?.isOpen)this.notebookView.close();else if(this.navigationPanel?.isOpen)this.navigationPanel.close();else if (this.settingsPanel?.isOpen) this.toggleSettings();
    }
  };
}
