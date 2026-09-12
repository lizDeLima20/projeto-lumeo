import type { AppState } from "../core/AppState";
import type { CatalogBookData } from "../models/CatalogBook";
import { CatalogService } from "../services/CatalogService";
import type { CatalogImportStage } from "../services/CatalogImportCoordinator";
import { BaseView } from "./BaseView";

export class CatalogBookView extends BaseView {
  public constructor(private readonly catalog: CatalogService, private readonly state: AppState, private readonly bookId: string,
    private readonly onBack: () => void, private readonly onOpenLocal: (bookId: string) => void,
    private readonly onAdd: (book: CatalogBookData, progress: (stage: CatalogImportStage, percent?: number | null) => void, signal?: AbortSignal) => Promise<void>) { super(); }
  public render(): HTMLElement {
    const section = this.createElement("section", "catalog-detail page-shell"); const status = this.createElement("p", "catalog__status", this.t("ui.common.loading")); section.append(status);
    void this.load(section, status); return section;
  }
  private async load(section: HTMLElement, status: HTMLElement): Promise<void> {
    try { const book = await this.catalog.get(this.bookId); status.remove(); section.append(this.detail(book)); }
    catch (error) { status.textContent = error instanceof Error ? error.message : this.t("ui.catalog.offline"); }
  }
  private detail(book: CatalogBookData): HTMLElement {
    const root = this.createElement("article", "catalog-detail__content"); const cover = this.createElement("div", "catalog-detail__cover");
    if (book.coverUrl) { const image = this.createElement("img", "") as HTMLImageElement; image.src = book.coverUrl; image.alt = this.t("ui.catalog.coverOf", { title: book.title }); cover.append(image); }
    else cover.append(this.createElement("span", "catalog-card__placeholder", book.title.slice(0, 1).toLocaleUpperCase()));
    const copy = this.createElement("div", "catalog-detail__copy"); const back = this.createElement("button", "link-button", this.t("ui.common.back")); back.type = "button"; back.addEventListener("click", this.onBack);
    copy.append(back, this.createElement("h1", "page-title", book.title), this.createElement("p", "page-subtitle", book.author));
    const metadata = this.createElement("dl", "catalog-detail__metadata"); this.meta(metadata, this.t("ui.catalog.genre"), book.genreName); this.meta(metadata, this.t("ui.catalog.format"), book.format.toUpperCase());
    if (book.fileSize) this.meta(metadata, this.t("ui.catalog.size"), this.formatSize(book.fileSize)); if (book.collection) this.meta(metadata, this.t("ui.catalog.collection"), book.collection); if (book.volume) this.meta(metadata, this.t("ui.catalog.volumeLabel"), book.volume);
    copy.append(metadata); if (book.description) copy.append(this.createElement("p", "catalog-detail__description", book.description));
    const local = this.state.books.find((item) => item.catalogBookId === book.bookId); const action = this.createElement("button", "button button--primary", local ? this.t("ui.catalog.open") : this.t("ui.catalog.add")); action.type = "button";
    const progress = this.createElement("p", "catalog__status"); progress.setAttribute("role", "status");
    if (local) action.addEventListener("click", () => this.onOpenLocal(local.id)); else action.addEventListener("click", () => void this.add(book, action, progress)); copy.append(action, progress); root.append(cover, copy); return root;
  }
  private async add(book: CatalogBookData, action: HTMLButtonElement, progress: HTMLElement): Promise<void> {
    action.disabled = true; const controller = new AbortController();
    try { await this.onAdd(book, (stage, percent) => { const label = this.t(`ui.catalog.${stage}` as never); progress.textContent = `${label}${percent == null ? "" : ` ${percent}%`}`; }, controller.signal); }
    catch (error) { action.disabled = false; progress.textContent = error instanceof Error ? error.message : this.t("ui.catalog.failed"); }
  }
  private meta(root: HTMLElement, label: string, value: string): void { root.append(this.createElement("dt", "", label), this.createElement("dd", "", value)); }
  private formatSize(bytes: number): string { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024) + " MB"; }
}
