import { I18nManager } from "../i18n/I18nManager";
import { ComicCoverSource, LazyCoverLoader } from "../services/ComicCoverSource";
import type { DriveCollectionService, DriveFolderEntry, DriveFolderListing } from "../services/DriveCollectionService";
import { BaseView } from "./BaseView";

/** Browses a published collection one folder at a time. It knows nothing about sagas,
 *  volumes or arcs: whatever the Drive folder holds is what the screen shows, at whatever
 *  depth the folder happens to sit. */
export class CollectionBrowserView extends BaseView {
  private readonly i18n = I18nManager.shared;
  private readonly covers = new ComicCoverSource();
  private loader: LazyCoverLoader | null = null;
  private list: HTMLElement | null = null;
  private trail: HTMLElement | null = null;
  private status: HTMLElement | null = null;

  private listing: DriveFolderListing | null = null;
  public constructor(private readonly collections: DriveCollectionService,
    private readonly collectionId: string, private readonly folderId: string | undefined,
    private readonly onOpenFolder: (collectionId: string, folderId: string) => void,
    private readonly onBack: () => void,
    private readonly path?: readonly string[],
    private readonly onAdd?: (entry: DriveFolderEntry, listing: DriveFolderListing) => void) { super(); }

  public override unmount(): void { this.loader?.destroy(); this.loader = null; super.unmount(); }

  public render(): HTMLElement {
    const section = this.createElement("section", "page-shell collection-browser");
    const back = this.createElement("button", "link-button", this.i18n.t("ui.common.back"));
    back.type = "button"; back.addEventListener("click", this.onBack);
    this.trail = this.createElement("nav", "collection-breadcrumb");
    this.trail.setAttribute("aria-label", this.i18n.t("ui.collections.breadcrumb"));
    this.list = this.createElement("ul", "collection-entries");
    this.status = this.createElement("p", "collection-status", this.i18n.t("ui.collections.loading"));
    this.status.setAttribute("role", "status");
    section.append(back, this.trail, this.status, this.list);
    void this.load();
    return section;
  }

  private async load(): Promise<void> {
    try {
      const listing = await this.collections.open(this.collectionId, this.folderId, this.path);
      this.paint(listing);
    } catch {
      // One folder failing is one folder: the screen keeps its trail and offers a retry
      // instead of going blank.
      if (!this.status) return;
      this.status.textContent = this.i18n.t("ui.collections.failed");
      const retry = this.createElement("button", "button button--secondary", this.i18n.t("ui.collections.retry"));
      retry.type = "button";
      retry.addEventListener("click", () => { retry.remove(); this.status!.textContent = this.i18n.t("ui.collections.loading"); void this.load(); });
      this.status.after(retry);
    }
  }

  private paint(listing: DriveFolderListing): void {
    if (!this.list || !this.trail || !this.status) return;
    this.listing = listing;
    this.trail.replaceChildren();
    listing.breadcrumb.forEach((step, index) => {
      const last = index === listing.breadcrumb.length - 1;
      if (index) this.trail!.append(this.createElement("span", "collection-breadcrumb__separator", "›"));
      if (last) { this.trail!.append(this.createElement("span", "collection-breadcrumb__current", step.name)); return; }
      const crumb = this.createElement("button", "collection-breadcrumb__step", step.name);
      crumb.type = "button";
      crumb.addEventListener("click", () => this.onOpenFolder(listing.collectionId, step.id));
      this.trail!.append(crumb);
    });
    this.list.replaceChildren();
    this.loader?.destroy();
    this.loader = new LazyCoverLoader(this.covers);
    listing.entries.forEach(entry => this.list!.append(this.entry(listing.collectionId, entry)));
    this.status.textContent = listing.entries.length ? "" : this.i18n.t("ui.collections.empty");
  }

  private entry(collectionId: string, entry: DriveFolderEntry): HTMLElement {
    const item = this.createElement("li", `collection-entry collection-entry--${entry.kind}`);
    item.dataset.driveId = entry.id;
    if (entry.format) item.dataset.format = entry.format;
    const label = this.createElement("span", "collection-entry__name", entry.name);
    if (entry.kind === "folder") {
      const open = this.createElement("button", "collection-entry__open");
      open.type = "button";
      const icon = this.createElement("span", "collection-entry__icon", "📁"); icon.setAttribute("aria-hidden", "true");
      open.append(icon, label, this.createElement("span", "collection-entry__chevron", "›"));
      open.addEventListener("click", () => this.onOpenFolder(collectionId, entry.id));
      item.append(open);
      return item;
    }
    const row = this.createElement("div", "collection-entry__file");
    row.append(this.thumbnail(entry), label);
    if (!entry.supported) {
      // Listed, named and clearly marked: hiding a CBR would quietly lose part of the folder.
      item.classList.add("collection-entry--unsupported");
      row.append(this.createElement("span", "collection-entry__badge", entry.format && entry.format !== "unknown"
        ? this.i18n.t("ui.collections.unsupported", { format: entry.format.toUpperCase() })
        : this.i18n.t("ui.collections.unknownFormat")));
    } else {
      if (entry.size) row.append(this.createElement("span", "collection-entry__size", this.size(entry.size)));
      if (this.onAdd) {
        const add = this.createElement("button", "collection-entry__add", this.i18n.t("ui.collections.add"));
        add.type = "button";
        add.setAttribute("aria-label", `${this.i18n.t("ui.collections.add")}: ${entry.name}`);
        add.addEventListener("click", () => { if (this.listing) this.onAdd!(entry, this.listing); });
        row.append(add);
      }
    }
    item.append(row);
    return item;
  }

  /** A comic shows its own first page; anything else shows a glyph. The image is only
   *  requested once the row is near the viewport. */
  private thumbnail(entry: DriveFolderEntry): HTMLElement {
    if (!this.covers.hasCover(entry)) {
      const icon = this.createElement("span", "collection-entry__icon", entry.supported ? "📄" : "🗜️");
      icon.setAttribute("aria-hidden", "true");
      return icon;
    }
    const image = this.createElement("img", "collection-entry__cover") as HTMLImageElement;
    image.alt = ""; image.loading = "lazy"; image.decoding = "async"; image.width = 40; image.height = 56;
    image.addEventListener("error", () => image.replaceWith(Object.assign(this.createElement("span", "collection-entry__icon", "📕"), { ariaHidden: "true" })));
    this.loader?.observe(image, entry);
    return image;
  }

  private size(bytes: number): string {
    const megabytes = bytes / 1_048_576;
    return megabytes >= 1 ? `${megabytes.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
}
