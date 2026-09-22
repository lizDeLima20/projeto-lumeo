import { I18nManager } from "../i18n/I18nManager";
import { ComicCoverSource, LazyCoverLoader } from "../services/ComicCoverSource";
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

  public constructor(
    private readonly collections: DriveCollectionService,
    private readonly collectionId: string,
    private readonly onBack: () => void,
    private readonly onAdd: (entry: DriveFolderEntry, listing: DriveFolderListing) => void,
  ) { super(); }

  public override unmount(): void {
    this.observer?.disconnect(); this.observer = null;
    this.coverLoader.destroy(); super.unmount();
  }

  public render(): HTMLElement {
    const page = this.createElement("section", "page-shell drive-collection-genre");
    const back = this.createElement("button", "link-button", this.i18n.t("ui.common.back"));
    back.type = "button"; back.addEventListener("click", this.onBack);
    const heading = this.createElement("div", "page-heading");
    const status = this.createElement("p", "drive-collection-genre__status", this.i18n.t("ui.collections.loading"));
    status.setAttribute("role", "status");
    const sections = this.createElement("div", "drive-collection-genre__sections");
    page.append(back, heading, status, sections);
    void this.loadRoot(heading, status, sections);
    return page;
  }

  private async loadRoot(heading: HTMLElement, status: HTMLElement, sections: HTMLElement): Promise<void> {
    try {
      const root = await this.collections.open(this.collectionId);
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
      const add = this.createElement("button", "button button--secondary drive-comic-card__add", this.i18n.t("ui.collections.add"));
      add.type = "button"; add.addEventListener("click", event => { event.stopPropagation(); this.onAdd(entry, listing); }); card.append(add);
    } else card.append(this.createElement("span", "drive-comic-card__unsupported", entry.format && entry.format !== "unknown"
      ? this.i18n.t("ui.collections.unsupported", { format: entry.format.toUpperCase() }) : this.i18n.t("ui.collections.unknownFormat")));
    return card;
  }
}
