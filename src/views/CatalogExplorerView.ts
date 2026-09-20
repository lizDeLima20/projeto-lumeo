import type { AppState } from "../core/AppState";
import type { CatalogBookData } from "../models/CatalogBook";
import { CatalogService } from "../services/CatalogService";
import { BaseView } from "./BaseView";

export class CatalogExplorerView extends BaseView {
  private readonly catalog: CatalogService;
  private cursor: string | null = null;
  private loading = false;
  private readonly loaded = new Set<string>();
  private readonly classified: HTMLElement = document.createElement("div");
  private status: HTMLElement | null = null;
  /** Genre folders of the remote catalogue become filters as soon as the API reports them. */
  private addCatalogGenre: (id: string, label: string) => void = () => undefined;
  public constructor(api: CatalogService, private readonly state: AppState, private readonly onOpen: (bookId: string) => void, private readonly onManageSources?: () => void) { super(); this.catalog = api; }
  public render(): HTMLElement {
    const section = this.createElement("section", "catalog page-shell");
    const heading = this.createElement("div", "page-heading"); heading.append(this.createElement("span", "eyebrow", this.t("ui.catalog.eyebrow")), this.createElement("h1", "page-title", this.t("ui.catalog.chooseBook")), this.createElement("p", "page-subtitle", this.t("ui.catalog.subtitle")));
    const controls = this.createElement("div", "catalog__controls");
    const search = this.createElement("input", "input") as HTMLInputElement; search.type = "search"; search.placeholder = this.t("ui.catalog.search"); search.setAttribute("aria-label", this.t("ui.catalog.search"));
    const genres = this.createElement("div", "catalog__genre-carousel"); let selectedGenre = ""; const availableGenres = new Set<string>();
    const selectGenre = (id: string): void => { selectedGenre = id; genres.querySelectorAll("button").forEach((button) => button.toggleAttribute("aria-pressed", button.dataset.genre === id)); this.reset(); void this.load(search.value, selectedGenre, more); };
    const addGenre = (id: string, label: string): void => { if (availableGenres.has(id)) return; availableGenres.add(id); const button = this.createElement("button", "catalog__genre-chip", label); button.type = "button"; button.dataset.genre = id; button.setAttribute("aria-pressed", String(id === selectedGenre)); button.addEventListener("click", () => selectGenre(id)); genres.append(button); };
    // Explore is the public catalogue: its filters are supplied only by the
    // active remote sources. Personal library categories belong in Biblioteca
    // and must never masquerade as catalogue genres here.
    addGenre("", this.t("ui.catalog.allGenres"));
    this.addCatalogGenre = addGenre;
    controls.append(search, genres);
    const list = this.createElement("div", "catalog__sections");
    this.classified.className = "catalog__grid";
    const classifiedSection = this.createElement("section", "catalog__section"); classifiedSection.append(this.createElement("h2", "catalog__section-title", this.t("ui.catalog.allGenres")), this.classified);
    list.append(classifiedSection);
    const status = this.createElement("p", "catalog__status"); status.setAttribute("role", "status"); this.status = status;
    const more = this.createElement("button", "button button--secondary catalog__more", this.t("ui.catalog.loadMore")); more.type = "button";
    let timer: number | undefined; const reload = (): void => { window.clearTimeout(timer); timer = window.setTimeout(() => { this.reset(); void this.load(search.value, selectedGenre, more); }, 250); };
    search.addEventListener("input", reload); more.addEventListener("click", () => void this.load(search.value, selectedGenre, more));
    section.append(heading, controls, list, status, more); void this.load("", "", more); void this.offerSourceManagement(heading); return section;
  }
  /** Administrators reach "Fontes do catálogo" from here; everyone else never sees the link. */
  private async offerSourceManagement(heading: HTMLElement): Promise<void> {
    if (!this.onManageSources) return;
    try {
      if (!(await this.catalog.adminStatus()).isAdmin) return;
      const link = this.createElement("button", "button button--secondary catalog__admin-link", this.t("ui.catalog.sources.title")); link.type = "button";
      link.addEventListener("click", () => this.onManageSources?.()); heading.append(link);
    } catch { /* No admin link when the status cannot be read. */ }
  }
  private reset(): void { this.cursor = null; this.loaded.clear(); this.classified.replaceChildren(); }
  private async load(query: string, genreId: string, more: HTMLButtonElement): Promise<void> {
    if (this.loading || this.cursor === "end") return; this.loading = true; more.disabled = true; this.status!.textContent = this.t("ui.common.loading");
    try {
      const page = await this.catalog.list({ cursor: this.cursor ?? undefined, query: query.trim() || undefined, genreId: genreId || undefined });
      page.genres?.forEach((genre) => this.addCatalogGenre(genre.id, genre.name));
      page.items.filter((book) => !this.loaded.has(book.bookId)).forEach((book) => {
        this.loaded.add(book.bookId);
        this.classified.append(this.card(book));
      });
      this.cursor = page.nextCursor ?? "end"; more.hidden = this.cursor === "end"; this.status!.textContent = this.loaded.size ? "" : this.t("ui.catalog.empty");
      this.classified.closest<HTMLElement>(".catalog__section")!.hidden = this.classified.childElementCount === 0;
    } catch (error) { this.status!.textContent = error instanceof Error ? error.message : this.t("ui.catalog.offline"); }
    finally { this.loading = false; more.disabled = false; }
  }
  private card(book: CatalogBookData): HTMLElement {
    const card = this.createElement("article", "catalog-card"); card.tabIndex = 0; card.addEventListener("click", () => this.onOpen(book.bookId)); card.addEventListener("keydown", (event) => { if (event.key === "Enter") this.onOpen(book.bookId); }); const cover = this.createElement("div", "catalog-card__cover");
    this.appendCover(cover, book);
    const title = this.createElement("h2", "catalog-card__title", book.title); const author = this.createElement("p", "catalog-card__author", book.author);
    const info = this.createElement("div", "catalog-card__info"); info.append(title, author);
    if (!this.isUnclassified(book)) info.append(this.createElement("small", "catalog-card__genre", book.genreName));
    if (book.volume) info.append(this.createElement("small", "catalog-card__volume", this.t("ui.catalog.volume", { volume: book.volume })));
    const action = this.createElement("button", "button button--secondary", this.isLocal(book) ? this.t("ui.catalog.inLibrary") : this.t("catalog.findBook")); action.type = "button";
    action.addEventListener("click", (event) => { event.stopPropagation(); this.onOpen(book.bookId); });
    card.append(cover, info, action); return card;
  }
  private isLocal(book: CatalogBookData): boolean { return this.state.books.some((item) => item.catalogBookId === book.bookId && item.availability === "AVAILABLE"); }
  private appendCover(root: HTMLElement, book: CatalogBookData): void {
    const fallback = (): void => root.replaceChildren(this.createElement("span", "catalog-card__placeholder", "📖"));
    if (!book.coverUrl) { fallback(); return; }
    const image = this.createElement("img", "") as HTMLImageElement; image.src = book.coverUrl; image.alt = this.t("ui.catalog.coverOf", { title: book.title }); image.loading = "lazy"; image.decoding = "async"; image.referrerPolicy = "no-referrer";
    image.addEventListener("error", fallback, { once: true }); root.append(image);
  }
  private isUnclassified(book: CatalogBookData): boolean { return !book.genreId || book.genreId === "sem-genero" || /^sem gênero$/i.test(book.genreName.trim()); }
}
