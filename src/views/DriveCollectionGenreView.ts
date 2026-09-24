import { I18nManager } from "../i18n/I18nManager";
import { ComicCoverSource, LazyCoverLoader } from "../services/ComicCoverSource";
import type { CatalogService } from "../services/CatalogService";
import type { DriveCollectionService, DriveFolderEntry, DriveFolderListing } from "../services/DriveCollectionService";
import { BaseView } from "./BaseView";

/**
 * Presents a published Drive collection as a catalogue genre. Drive folders remain the
 * source of truth, but are resolved behind the scenes into named comic sections rather
 * than being exposed as a file manager to the reader.
 */
export class DriveCollectionGenreView extends BaseView {
  private readonly i18n = I18nManager.shared;
  private readonly covers = new ComicCoverSource();
  private readonly coverLoader = new LazyCoverLoader(this.covers);
  private observer: IntersectionObserver | null = null;
  private readonly loadingFolders = new Set<string>();
  private searchVersion = 0;
  private rootListing: DriveFolderListing | null = null;
  private readonly genreActions = new Map<string, () => void>();
  private readonly genreIds = new Set<string>();
  private results: HTMLElement | null = null;
  private sections: HTMLElement | null = null;
  private status: HTMLElement | null = null;

  public constructor(
    private readonly collections: DriveCollectionService,
    private readonly catalog: CatalogService,
    private readonly collectionId: string,
    private readonly onBack: () => void,
    private readonly onSelectCatalogGenre: (genreId: string) => void,
    private readonly onSelectCollection: (collectionId: string) => void,
    private readonly onAdd: (entry: DriveFolderEntry, listing: DriveFolderListing) => void,
  ) { super(); }

  public override unmount(): void {
    this.observer?.disconnect(); this.observer = null;
    this.coverLoader.destroy(); super.unmount();
  }

  public render(): HTMLElement {
    const page = this.createElement("section", "catalog page-shell drive-collection-genre");
    const heading = this.createElement("div", "page-heading");
    this.status = this.createElement("p", "drive-collection-genre__status", this.i18n.t("ui.collections.loading"));
    this.status.setAttribute("role", "status");
    this.sections = this.createElement("div", "drive-collection-genre__sections");
    this.results = this.createElement("div", "drive-collection-genre__search-results");
    const controls = this.createElement("div", "catalog__controls");
    const search = this.createElement("input", "input") as HTMLInputElement;
    search.type = "search"; search.placeholder = this.i18n.t("ui.catalog.search"); search.setAttribute("aria-label", this.i18n.t("ui.catalog.search"));
    const genres = this.createElement("div", "catalog__genre-carousel");
    this.addGenre(genres, "", this.i18n.t("ui.catalog.allGenres"), this.onBack);
    this.enableGenreDrag(genres);
    controls.append(search, genres);
    let timer: number | undefined;
    search.addEventListener("input", () => { window.clearTimeout(timer); timer = window.setTimeout(() => void this.search(search.value), 250); });
    page.append(heading, controls, this.status, this.sections, this.results);
    void this.loadGenres(genres);
    void this.loadRoot(heading, this.status, this.sections);
    return page;
  }

  private async loadRoot(heading: HTMLElement, status: HTMLElement, sections: HTMLElement): Promise<void> {
    try {
      const root = await this.collections.open(this.collectionId);
      this.rootListing = root;
      const name = root.breadcrumb[0]?.name ?? "";
      heading.append(this.createElement("span", "eyebrow", this.i18n.t("ui.catalog.genre")), this.createElement("h1", "page-title", name));
      const files = root.entries.filter(entry => entry.kind === "file");
      if (files.length) this.appendCarousel(sections, root, files, name);
      const folders = root.entries.filter(entry => entry.kind === "folder");
      folders.forEach((folder, index) => this.appendFolderSection(sections, folder, root, index < 2));
      status.textContent = folders.length || files.length ? "" : this.i18n.t("ui.collections.empty");
    } catch {
      status.textContent = this.i18n.t("ui.collections.failed");
    }
  }

  /** A section only asks Drive for its own folder when it approaches the viewport. */
  private appendFolderSection(parent: HTMLElement, folder: DriveFolderEntry, parentListing: DriveFolderListing, eager = false): void {
    const section = this.createElement("section", "drive-collection-section");
    section.dataset.driveFolderId = folder.id;
    const title = this.createElement("h2", "drive-collection-section__title", folder.name.trim());
    const body = this.createElement("div", "drive-collection-section__body");
    const loading = this.createElement("p", "drive-collection-section__loading", this.i18n.t("ui.common.loading"));
    body.append(loading); section.append(title, body); parent.append(section);
    const path = [...parentListing.breadcrumb.map(step => step.id), folder.id];
    const load = (): void => void this.loadFolder(folder, path, body, loading);
    if (eager || typeof IntersectionObserver !== "function") { load(); return; }
    this.observer ??= new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      this.observer?.unobserve(entry.target);
      const callback = (entry.target as HTMLElement & { __lumeoCollectionLoad?: () => void }).__lumeoCollectionLoad;
      callback?.();
    }), { rootMargin: "320px 0px" });
    (section as HTMLElement & { __lumeoCollectionLoad?: () => void }).__lumeoCollectionLoad = load;
    this.observer.observe(section);
  }

  private async loadFolder(folder: DriveFolderEntry, path: readonly string[], body: HTMLElement, loading: HTMLElement): Promise<void> {
    if (this.loadingFolders.has(folder.id)) return;
    this.loadingFolders.add(folder.id);
    try {
      const listing = await this.collections.open(this.collectionId, folder.id, path);
      loading.remove();
      const files = listing.entries.filter(entry => entry.kind === "file");
      if (files.length) this.appendCarousel(body, listing, files);
      // Nested arcs retain their own heading, but are still lazy sections with covers,
      // never a raw second-level folder button.
      listing.entries.filter(entry => entry.kind === "folder")
        .forEach(child => this.appendFolderSection(body, child, listing));
      if (!listing.entries.length) body.append(this.createElement("p", "drive-collection-section__empty", this.i18n.t("ui.collections.empty")));
    } catch {
      loading.textContent = this.i18n.t("ui.collections.failed");
    } finally { this.loadingFolders.delete(folder.id); }
  }

  private appendCarousel(parent: HTMLElement, listing: DriveFolderListing, entries: readonly DriveFolderEntry[], label?: string): void {
    const group = this.createElement("div", "drive-comic-carousel");
    if (label) group.append(this.createElement("h2", "drive-comic-carousel__title", label));
    const track = this.createElement("div", "drive-comic-carousel__track");
    track.setAttribute("role", "list");
    entries.forEach(entry => track.append(this.card(entry, listing)));
    group.append(track); parent.append(group);
  }

  private card(entry: DriveFolderEntry, listing: DriveFolderListing): HTMLElement {
    const card = this.createElement("article", "drive-comic-card"); card.setAttribute("role", "listitem");
    const supported = entry.supported && (entry.format === "pdf" || entry.format === "epub");
    if (supported) { card.tabIndex = 0; card.addEventListener("click", () => this.onAdd(entry, listing)); card.addEventListener("keydown", event => { if (event.key === "Enter") this.onAdd(entry, listing); }); }
    const cover = this.createElement("div", "drive-comic-card__cover");
    const fallback = (): void => cover.replaceChildren(this.createElement("span", "drive-comic-card__fallback", "📚"));
    if (this.covers.hasCover(entry)) {
      const image = this.createElement("img", "") as HTMLImageElement;
      image.alt = `Capa de ${entry.name.trim()}`; image.loading = "lazy"; image.decoding = "async"; image.referrerPolicy = "no-referrer";
      image.addEventListener("error", fallback, { once: true }); this.coverLoader.observe(image, entry); cover.append(image);
    } else fallback();
    const title = this.createElement("h3", "drive-comic-card__title", entry.name.trim());
    const format = this.createElement("small", "drive-comic-card__format", entry.format?.toUpperCase() ?? this.i18n.t("ui.collections.unknownFormat"));
    card.append(cover, title, format);
    if (supported) {
      const add = this.createElement("button", "button button--secondary drive-comic-card__add", this.i18n.t("ui.comic.details"));
      add.type = "button"; add.addEventListener("click", event => { event.stopPropagation(); this.onAdd(entry, listing); }); card.append(add);
    } else card.append(this.createElement("span", "drive-comic-card__unsupported", entry.format && entry.format !== "unknown"
      ? this.i18n.t("ui.collections.unsupported", { format: entry.format.toUpperCase() }) : this.i18n.t("ui.collections.unknownFormat")));
    return card;
  }
  private addGenre(container: HTMLElement, id: string, label: string, action: () => void): void {
    if (this.genreIds.has(id)) return;
    this.genreIds.add(id); this.genreActions.set(id, action);
    const chip = this.createElement("button", "catalog__genre-chip", label);
    chip.type = "button"; chip.dataset.genre = id;
    chip.setAttribute("aria-pressed", String(id === `collection:${this.collectionId}`));
    chip.addEventListener("click", () => this.genreActions.get(id)?.()); container.append(chip);
  }

  private async loadGenres(container: HTMLElement): Promise<void> {
    try {
      const [page, collections] = await Promise.all([this.catalog.list(), this.collections.list()]);
      page.genres?.forEach(genre => this.addGenre(container, genre.id, genre.name, () => this.onSelectCatalogGenre(genre.id)));
      collections.forEach(collection => this.addGenre(container, `collection:${collection.id}`, collection.name, () => this.onSelectCollection(collection.id)));
    } catch { /* Keep the current collection usable if the genre list is unavailable. */ }
  }

  private enableGenreDrag(container: HTMLElement): void {
    let pointerId: number | null = null; let startX = 0; let scroll = 0; let dragging = false; let suppressClick = false;
    container.addEventListener("pointerdown", event => { if (event.pointerType !== "mouse" || event.button !== 0) return; pointerId = event.pointerId; startX = event.clientX; scroll = container.scrollLeft; dragging = false; });
    container.addEventListener("pointermove", event => {
      if (pointerId !== event.pointerId) return;
      const delta = event.clientX - startX;
      if (!dragging && Math.abs(delta) > 5) { dragging = true; container.setPointerCapture(event.pointerId); }
      if (dragging) container.scrollLeft = scroll - delta;
    });
    const finish = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) return;
      if (dragging) { suppressClick = true; if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId); window.setTimeout(() => { suppressClick = false; }, 0); }
      pointerId = null; dragging = false;
    };
    container.addEventListener("pointerup", finish); container.addEventListener("pointercancel", finish);
    container.addEventListener("click", event => { if (!suppressClick) return; event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }, true);
  }
  private async search(raw: string): Promise<void> {
    const query = raw.trim().toLocaleLowerCase();
    const version = ++this.searchVersion;
    if (!query) { this.results?.replaceChildren(); this.sections?.removeAttribute("hidden"); if (this.status) this.status.textContent = ""; return; }
    this.sections?.setAttribute("hidden", ""); this.results?.replaceChildren();
    if (this.status) this.status.textContent = this.i18n.t("ui.common.loading");
    try {
      const root = this.rootListing ?? await this.collections.open(this.collectionId);
      const queue: DriveFolderListing[] = [root]; const visited = new Set<string>(); const seenFiles = new Set<string>();
      const groups: Array<{ listing: DriveFolderListing; entries: DriveFolderEntry[]; label: string }> = [];
      while (queue.length) {
        if (version !== this.searchVersion) return;
        const listing = queue.shift()!;
        if (visited.has(listing.folderId)) continue;
        visited.add(listing.folderId);
        const entries = listing.entries.filter(entry => {
          if (entry.kind !== "file" || seenFiles.has(entry.id)) return false;
          const text = `${entry.name} ${entry.description ?? ""} ${listing.breadcrumb.map(step => step.name).join(" ")}`.toLocaleLowerCase();
          if (!text.includes(query)) return false;
          seenFiles.add(entry.id); return true;
        });
        if (entries.length) groups.push({ listing, entries, label: listing.breadcrumb[listing.breadcrumb.length - 1]?.name ?? "" });
        for (const folder of listing.entries.filter(entry => entry.kind === "folder")) {
          if (visited.has(folder.id)) continue;
          const path = [...listing.breadcrumb.map(step => step.id), folder.id];
          try { queue.push(await this.collections.open(this.collectionId, folder.id, path)); } catch { /* Continue in reachable folders. */ }
        }
      }
      if (version !== this.searchVersion) return;
      groups.forEach(group => this.appendCarousel(this.results!, group.listing, group.entries, group.label));
      if (this.status) this.status.textContent = groups.length ? "" : this.i18n.t("ui.catalog.empty");
    } catch {
      if (version === this.searchVersion && this.status) this.status.textContent = this.i18n.t("ui.collections.failed");
    }
  }
}
