import { I18nManager } from "../i18n/I18nManager";
import type { Book } from "../models/Book";
import { ComicCoverSource } from "../services/ComicCoverSource";
import { CollectionFileMismatchError, type CollectionImportRequest, type CollectionImportService } from "../services/CollectionImportService";
import type { DriveCollectionService, DriveFolderEntry, DriveFolderListing } from "../services/DriveCollectionService";
import { BaseView } from "./BaseView";

export interface ComicDetailsActions {
  importer: CollectionImportService;
  /** "android-private-storage" hands a File back; "browser-download" drops it in Downloads. */
  target: "browser-download" | "android-private-storage";
  genreId(listing: DriveFolderListing): Promise<string>;
  /** Asks the reader for the file the browser just downloaded - the catalogue's own picker. */
  pickDownloaded(): Promise<File | null>;
  added(book: Book): void;
  open(bookId: string): void;
}

/** The page a comic opens to from the catalogue, in the same shape as a catalogue book's:
 *  cover, what it is, and one action that walks download -> add -> open.
 *
 *  It never skips a step. On a phone the add button stays disabled until the download has
 *  finished; in a browser, where the file lands in Downloads, "add" asks for that file and
 *  checks it really is this comic before anything is saved. */
export class ComicDetailsView extends BaseView {
  private readonly i18n = I18nManager.shared;
  private readonly covers = new ComicCoverSource(480, 680);
  private downloaded: File | null = null;
  private browserDownloadStarted = false;

  public constructor(
    private readonly collections: DriveCollectionService,
    private readonly collectionId: string,
    private readonly fileId: string,
    private readonly folderId: string | undefined,
    private readonly path: readonly string[] | undefined,
    private readonly actions: ComicDetailsActions,
    private readonly onBack: () => void,
  ) { super(); }

  public render(): HTMLElement {
    const section = this.createElement("section", "catalog-detail page-shell comic-detail");
    const status = this.createElement("p", "catalog__status", this.i18n.t("ui.common.loading"));
    status.setAttribute("role", "status");
    section.append(status);
    void this.load(section, status);
    return section;
  }

  private async load(section: HTMLElement, status: HTMLElement): Promise<void> {
    try {
      const listing = await this.collections.open(this.collectionId, this.folderId, this.path);
      const entry = listing.entries.find(item => item.id === this.fileId && item.kind === "file");
      if (!entry) { status.textContent = this.i18n.t("ui.collections.failed"); return; }
      status.remove();
      section.append(this.detail(entry, listing));
    } catch {
      status.textContent = this.i18n.t("ui.collections.failed");
    }
  }

  private detail(entry: DriveFolderEntry, listing: DriveFolderListing): HTMLElement {
    const importer = this.actions.importer;
    const root = this.createElement("article", "catalog-detail__content");
    const cover = this.createElement("div", "catalog-detail__cover");
    this.appendCover(cover, entry);
    const copy = this.createElement("div", "catalog-detail__copy");
    const back = this.createElement("button", "link-button catalog-detail__back", this.i18n.t("ui.common.back"));
    back.type = "button"; back.addEventListener("click", this.onBack);
    const collection = listing.breadcrumb.slice(1).map(step => step.name.trim()).filter(Boolean);
    const readable = entry.supported && (entry.format === "pdf" || entry.format === "epub");
    const title = readable ? importer.title(entry, listing) : entry.name.trim();
    copy.append(back, this.createElement("h1", "page-title", title),
      this.createElement("p", "page-subtitle", listing.breadcrumb[0]?.name ?? ""));
    const metadata = this.createElement("dl", "catalog-detail__metadata");
    if (collection.length) this.meta(metadata, this.i18n.t("ui.catalog.collection"), collection.join(" › "));
    this.meta(metadata, this.i18n.t("ui.catalog.format"), (entry.format ?? "?").toUpperCase());
    if (entry.size) this.meta(metadata, this.i18n.t("ui.catalog.size"), this.formatSize(entry.size));
    copy.append(metadata);

    const progress = this.createElement("p", "catalog__status comic-detail__progress");
    progress.setAttribute("role", "status");
    if (!readable) {
      copy.append(this.createElement("p", "comic-detail__unsupported", entry.format && entry.format !== "unknown"
        ? this.i18n.t("ui.collections.unsupported", { format: entry.format.toUpperCase() }) : this.i18n.t("ui.collections.unknownFormat")));
      root.append(cover, copy); return root;
    }

    const actions = this.createElement("div", "comic-detail__actions");
    const download = this.createElement("button", "button button--primary catalog-detail__action", this.i18n.t("catalog.download"));
    const add = this.createElement("button", "button button--secondary comic-detail__add", this.i18n.t("ui.comic.addToLibrary"));
    download.type = "button"; add.type = "button"; add.disabled = true;
    actions.append(download, add);
    copy.append(actions, progress);
    root.append(cover, copy);

    const request = async (): Promise<CollectionImportRequest> =>
      ({ collectionId: this.collectionId, entry, listing, genreId: await this.actions.genreId(listing), cover: this.covers.coverUrl(entry) ?? undefined });
    const showOpen = (book: Book, message: string): void => {
      add.remove();
      download.disabled = false; download.textContent = this.i18n.t("ui.comic.open");
      download.onclick = () => this.actions.open(book.id);
      progress.textContent = message;
    };

    const existing = importer.existing({ collectionId: this.collectionId, entry });
    if (existing) { showOpen(existing, this.i18n.t("ui.comic.alreadyInLibrary")); return root; }

    download.onclick = () => void (async () => {
      try {
        download.disabled = true; progress.textContent = this.i18n.t("ui.catalog.downloading");
        const result = await importer.download(await request(), (current, total) => {
          progress.textContent = total && total > 0
            ? `${this.i18n.t("ui.catalog.downloading")} ${Math.min(100, Math.round(current * 100 / total))}%` : this.i18n.t("ui.catalog.downloading");
        });
        if (result.kind === "native-file") {
          this.downloaded = result.file;
          progress.textContent = this.i18n.t("ui.comic.downloaded");
        } else {
          this.browserDownloadStarted = true;
          progress.textContent = `${this.i18n.t("catalog.downloadStarted")} ${this.i18n.t("catalog.selectExpectedFile", { filename: result.expectedFilename })}`;
        }
        download.textContent = this.i18n.t("ui.comic.downloadAgain"); download.disabled = false;
        add.disabled = false;
      } catch {
        download.disabled = false; download.textContent = this.i18n.t("ui.common.retry");
        progress.textContent = this.i18n.t("ui.catalog.downloadFailed");
      }
    })();

    add.onclick = () => void (async () => {
      try {
        add.disabled = true;
        const file = this.downloaded ?? (this.browserDownloadStarted ? await this.actions.pickDownloaded() : null);
        if (!file) { add.disabled = false; return; }
        progress.textContent = this.i18n.t("ui.catalog.saving");
        const result = await importer.addDownloadedFile(await request(), file);
        if (result.kind === "browser-download") return;
        if (result.kind === "saved") this.actions.added(result.book);
        this.downloaded = null;
        showOpen(result.book, result.kind === "existing" ? this.i18n.t("ui.comic.alreadyInLibrary") : this.i18n.t("ui.comic.added"));
      } catch (error) {
        add.disabled = false;
        progress.textContent = error instanceof CollectionFileMismatchError ? this.i18n.t("ui.comic.fileMismatch")
          : error instanceof Error ? error.message : this.i18n.t("ui.catalog.downloadFailed");
      }
    })();
    return root;
  }

  private appendCover(root: HTMLElement, entry: DriveFolderEntry): void {
    const fallback = (): void => root.replaceChildren(this.createElement("span", "catalog-card__placeholder", "📚"));
    const url = this.covers.coverUrl(entry);
    if (!url) { fallback(); return; }
    const image = this.createElement("img", "") as HTMLImageElement;
    image.src = url; image.alt = this.i18n.t("ui.catalog.coverOf", { title: entry.name.trim() });
    image.decoding = "async"; image.referrerPolicy = "no-referrer";
    image.addEventListener("error", fallback, { once: true });
    root.append(image);
  }

  private meta(root: HTMLElement, label: string, value: string): void {
    root.append(this.createElement("dt", "", label), this.createElement("dd", "", value));
  }
  private formatSize(bytes: number): string {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024) + " MB";
  }
}
