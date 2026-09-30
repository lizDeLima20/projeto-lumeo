import type { AppState } from "../core/AppState";
import type { CatalogBookData } from "../models/CatalogBook";
import { CatalogService } from "../services/CatalogService";
import { ComicCoverSource, LazyCoverLoader } from "../services/ComicCoverSource";
import type { DriveCollection, DriveCollectionService, DriveCollectionSearchResult, DriveFolderEntry, DriveFolderListing } from "../services/DriveCollectionService";
import { BaseView } from "./BaseView";

/** Folds text the same way search already does, so cosmetic differences - case, accent,
 *  punctuation - collapse into the same key. */
function foldCatalogText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** The same title alone is not the same book - "O Segredo" can be two unrelated novels -
 *  so identity also asks who wrote it, and, when the catalogue records them, which volume
 *  and which collection: two entries that agree on title and author but name different
 *  volumes are two real books, not one imported twice. A record with no author at all
 *  carries too little to safely fold into anything else, so its own bookId keeps it
 *  standing on its own rather than risking a different, unrelated book silently
 *  disappearing behind it. Exported so the exact rule can be exercised directly in tests,
 *  without instantiating a view that needs a live DOM. */
export function catalogIdentityKey(book: Pick<CatalogBookData, "bookId" | "title" | "author" | "volume" | "collection">): string {
  const title = foldCatalogText(book.title);
  const author = foldCatalogText(book.author);
  if (!author) return `title:${title}:id:${book.bookId}`;
  const volume = foldCatalogText(book.volume ?? "");
  const collection = foldCatalogText(book.collection ?? "");
  return `title:${title}:author:${author}:volume:${volume}:collection:${collection}`;
}

export class CatalogExplorerView extends BaseView {
  private readonly catalog: CatalogService;
  private cursor: string | null = null;
  private loading = false;
  private pendingLoad: { query: string; genreId: string; more: HTMLButtonElement } | null = null;
  private loadVersion = 0;
  private readonly loaded = new Set<string>();
  private readonly classified: HTMLElement = document.createElement("div");
  private readonly comicCovers = new ComicCoverSource();
  private readonly comicCoverLoader = new LazyCoverLoader(this.comicCovers);
  private searchQuery = "";
  private selectedGenre: string;
  private searchResults: Array<CatalogBookData | DriveCollectionSearchResult> = [];
  private isSearching = false;
  private genreCarouselCleanup: (() => void) | null = null;
  private status: HTMLElement | null = null;
  /** Genre folders of the remote catalogue become filters as soon as the API reports them. */
  private addCatalogGenre: (id: string, label: string) => void = () => undefined;
  /** The label behind every chip offered so far, so the title above the results can be
   *  rebuilt for a genre whose own chip arrived after the page did - a genre opened
   *  straight from a link, restored on reload, still without its name at first paint. */
  private readonly genreLabels = new Map<string, string>();
  private sectionTitle: HTMLElement | null = null;
  public constructor(api: CatalogService, private readonly state: AppState, private readonly onOpen: (bookId: string) => void, private readonly onManageSources?: () => void,
    private readonly published?: { collections: DriveCollectionService; open: (collection: DriveCollection) => void;
      openEntry?: (collectionId: string, entry: DriveFolderEntry, listing: DriveFolderListing) => void }, initialGenreId = "") { super(); this.catalog = api; this.selectedGenre = initialGenreId; }
  public override unmount(): void { this.genreCarouselCleanup?.(); this.genreCarouselCleanup = null; this.comicCoverLoader.destroy(); super.unmount(); }
  public render(): HTMLElement {
    const section = this.createElement("section", "catalog catalog--explore page-shell");
    const heading = this.createElement("div", "page-heading"); heading.append(this.createElement("span", "eyebrow", this.t("ui.catalog.eyebrow")), this.createElement("h1", "page-title", this.t("ui.catalog.chooseBook")), this.createElement("p", "page-subtitle", this.t("ui.catalog.subtitle")));
    const controls = this.createElement("div", "catalog__controls");
    const search = this.createElement("input", "input") as HTMLInputElement; search.type = "search"; search.placeholder = this.t("ui.catalog.search"); search.setAttribute("aria-label", this.t("ui.catalog.search"));
    const genreNavigation = this.createElement("div", "catalog__genre-navigation");
    const previousGenres = this.createElement("button", "catalog__genre-arrow catalog__genre-arrow--previous", "‹"); previousGenres.type = "button"; previousGenres.setAttribute("aria-label", "Gêneros anteriores");
    const genres = this.createElement("div", "catalog__genre-carousel"); const availableGenres = new Set<string>(); const genreActions = new Map<string, () => void>();
    const nextGenres = this.createElement("button", "catalog__genre-arrow catalog__genre-arrow--next", "›"); nextGenres.type = "button"; nextGenres.setAttribute("aria-label", "Próximos gêneros");
    // Selecting a genre is what the section title answers to - never the results that
    // happen to have loaded, which can still be settling from the previous one.
    const selectGenre = (id: string, label: string): void => {
      this.selectedGenre = id; this.sectionTitle!.textContent = this.genreTitle(id, label);
      const action = genreActions.get(id); if (action) { action(); return; }
      genres.querySelectorAll("button").forEach((button) => button.toggleAttribute("aria-pressed", button.dataset.genre === id));
      this.reset(); void this.load(search.value, this.selectedGenre, more);
    };
    const addGenre = (id: string, label: string, action?: () => void): void => {
      if (availableGenres.has(id)) return; availableGenres.add(id); if (action) genreActions.set(id, action);
      this.genreLabels.set(id, label);
      // The chip for the genre a reload restored can arrive after the first paint - its
      // name was unknown then, and the title is redrawn now that it isn't.
      if (id === this.selectedGenre && this.sectionTitle) this.sectionTitle.textContent = this.genreTitle(id, label);
      const button = this.createElement("button", "catalog__genre-chip", label); button.type = "button"; button.dataset.genre = id;
      button.setAttribute("aria-pressed", String(id === this.selectedGenre)); button.addEventListener("click", () => selectGenre(id, label)); genres.append(button);
    };
    // Explore is the public catalogue: its filters are supplied only by the
    // active remote sources. Personal library categories belong in Biblioteca
    // and must never masquerade as catalogue genres here.
    addGenre("", this.t("ui.catalog.allGenres"));
    this.addCatalogGenre = addGenre;
    this.enableGenreDrag(genres);
    this.enableDesktopGenreNavigation(genres, previousGenres, nextGenres);
    genreNavigation.append(previousGenres, genres, nextGenres); controls.append(search, genreNavigation);
    const list = this.createElement("div", "catalog__sections");
    this.classified.className = "catalog__grid";
    const sectionTitle = this.createElement("h2", "catalog__section-title", this.genreTitle(this.selectedGenre, this.genreLabels.get(this.selectedGenre) ?? ""));
    this.sectionTitle = sectionTitle;
    const classifiedSection = this.createElement("section", "catalog__section"); classifiedSection.append(sectionTitle, this.classified);
    list.append(classifiedSection);
    const status = this.createElement("p", "catalog__status"); status.setAttribute("role", "status"); this.status = status;
    const more = this.createElement("button", "button button--secondary catalog__more", this.t("ui.catalog.loadMore")); more.type = "button";
    let timer: number | undefined; const reload = (): void => { window.clearTimeout(timer); timer = window.setTimeout(() => { this.searchQuery = search.value; this.reset(); void this.load(this.searchQuery, this.selectedGenre, more); }, 250); };
    search.addEventListener("input", reload); more.addEventListener("click", () => void this.load(search.value, this.selectedGenre, more));
    section.append(heading, controls, list, status, more);
    void this.load("", this.selectedGenre, more); void this.offerSourceManagement(heading); void this.offerCollections(addGenre); return section;
  }
  /** A published Drive collection participates in the very same genre strip as the
   * catalogue sources. Its own page can then resolve its nested Drive folders lazily. */
  private async offerCollections(addGenre: (id: string, label: string, action?: () => void) => void): Promise<void> {
    if (!this.published) return;
    const collections = await this.published.collections.list();
    if (!collections.length) return;
    collections.forEach((collection) => {
      addGenre(`collection:${collection.id}`, collection.name, () => this.published!.open(collection));
    });
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
  /** Universal search only: the best card shown so far for each identity, so a later,
   *  better-classified copy of a book already on the page can take its place. */
  private readonly bestByIdentity = new Map<string, { rank: number; element: HTMLElement }>();
  private reset(): void { this.loadVersion += 1; this.pendingLoad = null; this.cursor = null; this.loaded.clear(); this.bestByIdentity.clear(); this.searchResults = []; this.classified.replaceChildren(); }
  private async load(query: string, genreId: string, more: HTMLButtonElement): Promise<void> {
    if (this.loading) { this.pendingLoad = { query, genreId, more }; return; }
    if (this.cursor === "end") return;
    const version = this.loadVersion;
    this.loading = true; more.disabled = true; this.status!.textContent = this.t("ui.common.loading");
    try {
      const normalizedQuery = query.trim(); const firstPage = this.cursor === null;
      this.searchQuery = query; this.isSearching = Boolean(normalizedQuery);
      // Comics live behind a far slower search of their own - a full, live walk of every
      // Drive collection folder - that can take much longer than the catalogue's own,
      // already-indexed lookup. Firing it apart from the catalogue fetch, rather than
      // Promise.all-ing the two together, keeps a comic-inclusive search from making
      // "Carregando..." sit for as long as the slower of the two, when the reader's book
      // results are ready far sooner; appendComics() slots comics in once they do arrive.
      if (firstPage && normalizedQuery && !genreId && this.published) {
        void this.published.collections.search(normalizedQuery).catch(() => []).then(comics => this.appendComics(comics, version));
      }
      const page = await this.catalog.list({ cursor: this.cursor ?? undefined, query: normalizedQuery || undefined, genreId: genreId || undefined });
      if (version !== this.loadVersion) return;
      page.genres?.forEach((genre) => this.addCatalogGenre(genre.id, genre.name));
      // "Todos os gêneros" reaches every genre's own catalogue at once, so the same title
      // can arrive twice - once filed under its real genre, once from an unclassified
      // import. The reader sees one card, and it is the classified one.
      const universal = !genreId && this.isSearching;
      page.items.filter((book) => !this.loaded.has(book.bookId)).forEach((book) => {
        this.loaded.add(book.bookId);
        if (!universal) { this.classified.append(this.card(book)); return; }
        const key = this.identityKey(book), rank = this.genreRank(book), current = this.bestByIdentity.get(key);
        if (current && current.rank >= rank) return;
        current?.element.remove();
        const element = this.card(book);
        this.bestByIdentity.set(key, { rank, element });
        this.classified.append(element);
      });
      if (firstPage && normalizedQuery) this.searchResults = [...page.items];
      this.cursor = page.nextCursor ?? "end"; more.hidden = this.cursor === "end";
      this.refreshStatus();
      this.classified.closest<HTMLElement>(".catalog__section")!.hidden = this.classified.childElementCount === 0;
    } catch (error) {
      if (version === this.loadVersion) this.status!.textContent = error instanceof Error ? error.message : this.t("ui.catalog.offline");
    } finally {
      this.loading = false; more.disabled = false;
      const pending = this.pendingLoad;
      this.pendingLoad = null;
      if (pending) void this.load(pending.query, pending.genreId, pending.more);
    }
  }
  /** Slots comics into an already-rendered search once their much slower fetch resolves.
   *  `version` guards against a comic search left over from a query the reader has since
   *  changed - `this.loadVersion` has moved on by then, and the stale batch is dropped. */
  private appendComics(comics: readonly DriveCollectionSearchResult[], version: number): void {
    if (version !== this.loadVersion) return;
    comics.filter(result => !this.loaded.has("comic:" + result.collection.id + ":" + result.entry.id)).forEach(result => {
      this.loaded.add("comic:" + result.collection.id + ":" + result.entry.id);
      this.classified.append(this.comicCard(result));
    });
    this.searchResults = [...this.searchResults, ...comics];
    this.refreshStatus();
    this.classified.closest<HTMLElement>(".catalog__section")!.hidden = this.classified.childElementCount === 0;
  }
  private refreshStatus(): void {
    const empty = this.isSearching ? this.searchResults.length === 0 : this.loaded.size === 0;
    this.status!.textContent = empty ? this.t("ui.catalog.empty") : "";
  }
  private comicCard(result: DriveCollectionSearchResult): HTMLElement {
    const { collection, entry, listing } = result;
    const card = this.createElement("article", "drive-comic-card"); card.setAttribute("role", "listitem"); card.tabIndex = 0;
    const open = (): void => { if (this.published?.openEntry) this.published.openEntry(collection.id, entry, listing); else this.published?.open(collection); };
    card.addEventListener("click", open); card.addEventListener("keydown", event => { if (event.key === "Enter") open(); });
    const cover = this.createElement("div", "drive-comic-card__cover");
    const fallback = (): void => cover.replaceChildren(this.createElement("span", "drive-comic-card__fallback", "📚"));
    const image = this.createElement("img", "") as HTMLImageElement;
    image.alt = `Capa de ${entry.name.trim()}`; image.loading = "lazy"; image.decoding = "async"; image.referrerPolicy = "no-referrer";
    image.addEventListener("error", fallback, { once: true }); cover.append(image);
    this.comicCoverLoader.observe(image, entry, fallback);
    const path = listing.breadcrumb.slice(1).map(step => step.name).join(" · ") || collection.name;
    card.append(cover, this.createElement("h3", "drive-comic-card__title", entry.name.trim()), this.createElement("small", "drive-comic-card__format", path));
    return card;
  }
  private enableGenreDrag(container: HTMLElement): void {
    let pointerId: number | null = null;
    let startX = 0;
    let startScroll = 0;
    let dragging = false;
    let suppressClick = false;
    container.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      pointerId = event.pointerId; startX = event.clientX; startScroll = container.scrollLeft; dragging = false;
    });
    container.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId) return;
      const delta = event.clientX - startX;
      if (!dragging && Math.abs(delta) > 5) { dragging = true; container.setPointerCapture(event.pointerId); }
      if (dragging) container.scrollLeft = startScroll - delta;
    });
    const finish = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) return;
      if (dragging) {
        suppressClick = true;
        if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
        window.setTimeout(() => { suppressClick = false; }, 0);
      }
      pointerId = null; dragging = false;
    };
    container.addEventListener("pointerup", finish);
    container.addEventListener("pointercancel", finish);
    container.addEventListener("click", (event) => {
      if (!suppressClick) return;
      event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false;
    }, true);
  }
  private enableDesktopGenreNavigation(container: HTMLElement, previous: HTMLButtonElement, next: HTMLButtonElement): void {
    const update = (): void => {
      const limit = Math.max(0, container.scrollWidth - container.clientWidth);
      previous.disabled = container.scrollLeft <= 1;
      next.disabled = limit <= 1 || container.scrollLeft >= limit - 1;
    };
    const scroll = (direction: -1 | 1): void => container.scrollBy({
      left: direction * Math.max(280, container.clientWidth * .78),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    previous.addEventListener("click", () => scroll(-1)); next.addEventListener("click", () => scroll(1));
    container.addEventListener("scroll", update, { passive: true });
    const mutation = new MutationObserver(() => window.requestAnimationFrame(update)); mutation.observe(container, { childList: true });
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null; resize?.observe(container);
    window.requestAnimationFrame(update);
    this.genreCarouselCleanup = () => { mutation.disconnect(); resize?.disconnect(); container.removeEventListener("scroll", update); };
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

  /** The title above the results, computed only from `selectedGenre` - never from what
   *  happened to load, which settles a moment later and must never be what decides what
   *  the reader thinks they are looking at. A Drive collection keeps its own name; every
   *  other genre is announced, so "Autoajuda" reads as the shelf it is, not a book. */
  private genreTitle(id: string, label: string): string {
    if (!id) return this.t("ui.catalog.allGenres");
    if (id.startsWith("collection:")) return label;
    return `${this.t("ui.catalog.genre")}: ${label}`;
  }

  /** See {@link catalogIdentityKey} - kept as a thin method so `load()` reads the same as
   *  before, with the actual rule defined once, outside the class, where it can be tested
   *  without a DOM. */
  private identityKey(book: CatalogBookData): string { return catalogIdentityKey(book); }
  /** A record with its own genre outranks the very same title sitting in the unclassified
   *  pile - the pile is a fallback for the reader to still find it, never the copy to show
   *  once the real one is also on the page. */
  private genreRank(book: CatalogBookData): number { return this.isUnclassified(book) ? 0 : 1; }
}
