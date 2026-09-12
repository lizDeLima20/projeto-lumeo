import type { AppState } from "../core/AppState";
import type { CatalogBookData } from "../models/CatalogBook";
import { CatalogService } from "../services/CatalogService";
import type { CatalogImportStage } from "../services/CatalogImportCoordinator";
import { BaseView } from "./BaseView";

export class CatalogExplorerView extends BaseView {
  private readonly catalog: CatalogService;
  private cursor: string | null = null;
  private loading = false;
  private readonly loaded = new Set<string>();
  private list: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  public constructor(api: CatalogService, private readonly state: AppState, private readonly onOpen: (bookId: string) => void,
    private readonly onAdd: (book: CatalogBookData, progress: (stage: CatalogImportStage, percent?: number | null) => void) => Promise<void>) { super(); this.catalog = api; }
  public render(): HTMLElement {
    const section = this.createElement("section", "catalog page-shell");
    const heading = this.createElement("div", "page-heading"); heading.append(this.createElement("span", "eyebrow", this.t("ui.catalog.eyebrow")), this.createElement("h1", "page-title", this.t("ui.catalog.title")), this.createElement("p", "page-subtitle", this.t("ui.catalog.subtitle")));
    const controls = this.createElement("div", "catalog__controls");
    const search = this.createElement("input", "input") as HTMLInputElement; search.type = "search"; search.placeholder = this.t("ui.catalog.search"); search.setAttribute("aria-label", this.t("ui.catalog.search"));
    const genre = this.createElement("select", "input") as HTMLSelectElement; genre.append(new Option(this.t("ui.catalog.allGenres"), "")); this.state.genres.forEach((value) => genre.append(new Option(value.name, value.id)));
    controls.append(search, genre); const list = this.createElement("div", "catalog__grid"); this.list = list;
    const status = this.createElement("p", "catalog__status"); status.setAttribute("role", "status"); this.status = status;
    const more = this.createElement("button", "button button--secondary catalog__more", this.t("ui.catalog.loadMore")); more.type = "button";
    let timer: number | undefined; const reload = (): void => { window.clearTimeout(timer); timer = window.setTimeout(() => { this.reset(); void this.load(search.value, genre.value, more); }, 250); };
    search.addEventListener("input", reload); genre.addEventListener("change", reload); more.addEventListener("click", () => void this.load(search.value, genre.value, more));
    section.append(heading, controls, list, status, more); void this.load("", "", more); return section;
  }
  private reset(): void { this.cursor = null; this.loaded.clear(); this.list?.replaceChildren(); }
  private async load(query: string, genreId: string, more: HTMLButtonElement): Promise<void> {
    if (this.loading || this.cursor === "end") return; this.loading = true; more.disabled = true; this.status!.textContent = this.t("ui.common.loading");
    try {
      const page = await this.catalog.list({ cursor: this.cursor ?? undefined, query: query.trim() || undefined, genreId: genreId || undefined });
      page.items.filter((book) => !this.loaded.has(book.bookId)).forEach((book) => { this.loaded.add(book.bookId); this.list?.append(this.card(book)); });
      this.cursor = page.nextCursor ?? "end"; more.hidden = this.cursor === "end"; this.status!.textContent = this.loaded.size ? "" : this.t("ui.catalog.empty");
    } catch (error) { this.status!.textContent = error instanceof Error ? error.message : this.t("ui.catalog.offline"); }
    finally { this.loading = false; more.disabled = false; }
  }
  private card(book: CatalogBookData): HTMLElement {
    const card = this.createElement("article", "catalog-card"); card.tabIndex = 0; card.addEventListener("click", () => this.onOpen(book.bookId)); card.addEventListener("keydown", (event) => { if (event.key === "Enter") this.onOpen(book.bookId); }); const cover = this.createElement("div", "catalog-card__cover");
    if (book.coverUrl) { const image = this.createElement("img", "") as HTMLImageElement; image.src = book.coverUrl; image.alt = this.t("ui.catalog.coverOf", { title: book.title }); image.loading = "lazy"; cover.append(image); }
    else cover.append(this.createElement("span", "catalog-card__placeholder", book.title.slice(0, 1).toLocaleUpperCase()));
    const title = this.createElement("h2", "catalog-card__title", book.title); const author = this.createElement("p", "catalog-card__author", book.author);
    const info = this.createElement("div", "catalog-card__info"); info.append(title, author);
    if (book.volume) info.append(this.createElement("small", "catalog-card__volume", this.t("ui.catalog.volume", { volume: book.volume })));
    const action = this.createElement("button", "button button--secondary", this.isLocal(book) ? this.t("ui.catalog.inLibrary") : this.t("ui.catalog.add")); action.type = "button";
    action.addEventListener("click", (event) => { event.stopPropagation(); void this.addFromCard(book, action); });
    card.append(cover, info, action); return card;
  }
  private isLocal(book: CatalogBookData): boolean { return this.state.books.some((item) => item.catalogBookId === book.bookId); }
  private async addFromCard(book: CatalogBookData, action: HTMLButtonElement): Promise<void> {
    const local = this.state.books.find((item) => item.catalogBookId === book.bookId);
    if (local) { this.onOpen(book.bookId); return; }
    action.disabled = true;
    try { await this.onAdd(book, (stage, percent) => { action.textContent = `${this.t(`ui.catalog.${stage}` as never)}${percent == null ? "" : ` ${percent}%`}`; }); }
    catch (error) { action.disabled = false; action.textContent = error instanceof Error ? error.message : this.t("ui.catalog.failed"); }
  }
}
