import { I18nManager } from "../i18n/I18nManager";
import type { Book } from "../models/Book";
import { ComicCoverSource } from "../services/ComicCoverSource";
import { defaultComicCoverGenerator, type ComicCoverAsset } from "../services/ComicCoverGenerator";
import { ComicPresentationService, type ComicMetadata } from "../services/ComicPresentationService";
import { CollectionFileMismatchError, type CollectionImportRequest, type CollectionImportService } from "../services/CollectionImportService";
import type { DriveCollectionService, DriveFolderEntry, DriveFolderListing } from "../services/DriveCollectionService";
import { DuplicateBookImportError } from "../services/ImportManager";
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
  private readonly coverGenerator = defaultComicCoverGenerator();
  private readonly presentations = new ComicPresentationService();
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
    const copy = this.createElement("div", "catalog-detail__copy");
    let resolvedCover: string | undefined;
    let resolvedMetadata: ComicMetadata | undefined;
    const back = this.createElement("button", "link-button catalog-detail__back", this.i18n.t("ui.common.back"));
    back.type = "button"; back.addEventListener("click", this.onBack);
    const collection = listing.breadcrumb.slice(1).map(step => step.name.trim()).filter(Boolean);
    const readable = entry.supported && (entry.format === "pdf" || entry.format === "cbr" || entry.format === "cbz");
    const initial = this.presentations.present(entry, listing);
    const heading = this.createElement("h1", "page-title", readable ? initial.title : entry.name.trim());
    const byline = this.createElement("p", "page-subtitle");
    const updatePresentation = (metadata?: ComicMetadata): void => {
      const value = this.presentations.present(entry, listing, metadata);
      heading.textContent = readable ? value.title : entry.name.trim();
      byline.textContent = [value.author, value.year ? String(value.year) : ""].filter(Boolean).join(" · ") || (listing.breadcrumb[0]?.name ?? "");
    };
    updatePresentation();
    copy.append(back, heading, byline);
    const metadata = this.createElement("dl", "catalog-detail__metadata");
    if (collection[0]) this.meta(metadata, this.i18n.t("ui.catalog.collection"), collection[0]);
    if (collection.length > 1) this.meta(metadata, this.i18n.t("ui.comic.arc"), collection.slice(1).join(" › "));
    this.meta(metadata, this.i18n.t("ui.catalog.format"), entry.format === "pdf" ? "PDF" : (entry.format ?? "?").toUpperCase());
    if (entry.size) this.meta(metadata, this.i18n.t("ui.catalog.size"), this.formatSize(entry.size));
    const synopsis = this.createElement("p", "catalog-detail__description");
    const updateSynopsis = (comicMetadata?: ComicMetadata): void => {
      const text = comicMetadata?.summary?.trim() || entry.description?.trim() || "";
      synopsis.textContent = text;
      synopsis.toggleAttribute("hidden", !text);
    };
    updateSynopsis();
    copy.append(synopsis, metadata);

    const progress = this.createElement("p", "catalog__status comic-detail__progress");
    progress.setAttribute("role", "status");
    progress.dataset.state = "ready";
    progress.textContent = this.i18n.t("ui.comic.ready");
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
    const coverResolution = this.appendCover(cover, entry, asset => {
      resolvedCover = asset.dataUrl; resolvedMetadata = asset.metadata;
      updatePresentation(asset.metadata); updateSynopsis(asset.metadata);
    });

    const request = async (): Promise<CollectionImportRequest> => {
      const asset = await coverResolution;
      return {
        collectionId: this.collectionId, entry, listing, genreId: await this.actions.genreId(listing),
        cover: resolvedCover ?? asset?.dataUrl, comicMetadata: resolvedMetadata ?? asset?.metadata,
      };
    };
    const showOpen = (book: Book, message: string): void => {
      add.remove();
      download.disabled = false; download.textContent = this.i18n.t("ui.comic.open");
      download.onclick = () => this.actions.open(book.id);
      progress.dataset.state = "added"; progress.textContent = message;
    };

    const existing = importer.existing({ collectionId: this.collectionId, entry });
    if (existing) { showOpen(existing, this.i18n.t("ui.comic.alreadyInLibrary")); return root; }

    download.onclick = () => void (async () => {
      try {
        download.disabled = true; progress.dataset.state = "downloading"; progress.textContent = this.i18n.t("ui.catalog.downloading");
        const result = await importer.download(await request(), (current, total) => {
          progress.textContent = total && total > 0
            ? `${this.i18n.t("ui.catalog.downloading")} ${Math.min(100, Math.round(current * 100 / total))}%` : this.i18n.t("ui.catalog.downloading");
        });
        if (result.kind === "native-file") {
          progress.dataset.state = "saving"; progress.textContent = this.i18n.t("ui.catalog.saving");
          const saved = await importer.addDownloadedFile(await request(), result.file);
          if (saved.kind === "browser-download") return;
          if (saved.kind === "saved") this.actions.added(saved.book);
          this.downloaded = null;
          showOpen(saved.book, saved.kind === "existing" ? this.i18n.t("ui.comic.alreadyInLibrary") : this.i18n.t("ui.comic.added"));
          return;
        } else {
          this.browserDownloadStarted = true;
          progress.dataset.state = "downloaded"; progress.textContent = `${this.i18n.t("catalog.downloadStarted")} ${this.i18n.t("catalog.selectExpectedFile", { filename: result.expectedFilename })}`;
        }
        download.textContent = this.i18n.t("ui.comic.downloadAgain"); download.disabled = false;
        add.disabled = false;
      } catch (error) {
        // The download itself can succeed while the later import step finds this exact file
        // already in the library (by content hash, not only by this comic's own identity) -
        // that is success, not a download failure, and the UI must say so. Unlike the
        // existing(request) check above (which only ever matches a book this session's own
        // library state already knows about), this is the one path where the match comes
        // from the repository alone - this session has not seen this book yet, so it must be
        // added to the live state here, or it would stay invisible until the app restarts.
        if (error instanceof DuplicateBookImportError) { this.actions.added(error.decision.book); showOpen(error.decision.book, this.i18n.t("ui.comic.alreadyInLibrary")); return; }
        download.disabled = false; progress.dataset.state = "error"; download.textContent = this.i18n.t("ui.common.retry");
        progress.textContent = error instanceof CollectionFileMismatchError ? this.i18n.t("ui.comic.fileMismatch")
          : error instanceof Error ? error.message : this.i18n.t("ui.catalog.downloadFailed");
      }
    })();

    add.onclick = () => void (async () => {
      try {
        add.disabled = true;
        const file = this.downloaded ?? (this.browserDownloadStarted ? await this.actions.pickDownloaded() : null);
        if (!file) { add.disabled = false; return; }
        progress.dataset.state = "saving"; progress.textContent = this.i18n.t("ui.catalog.saving");
        const result = await importer.addDownloadedFile(await request(), file);
        if (result.kind === "browser-download") return;
        if (result.kind === "saved") this.actions.added(result.book);
        this.downloaded = null;
        showOpen(result.book, result.kind === "existing" ? this.i18n.t("ui.comic.alreadyInLibrary") : this.i18n.t("ui.comic.added"));
      } catch (error) {
        if (error instanceof DuplicateBookImportError) { this.actions.added(error.decision.book); showOpen(error.decision.book, this.i18n.t("ui.comic.alreadyInLibrary")); return; }
        add.disabled = false;
        progress.dataset.state = "error"; progress.textContent = error instanceof CollectionFileMismatchError ? this.i18n.t("ui.comic.fileMismatch")
          : error instanceof Error ? error.message : this.i18n.t("ui.catalog.downloadFailed");
      }
    })();
    return root;
  }

  private appendCover(root: HTMLElement, entry: DriveFolderEntry, onResolved: (asset: ComicCoverAsset) => void): Promise<ComicCoverAsset | null> {
    const placeholder = this.createElement("span", "catalog-card__placeholder", "📚");
    const show = (source: string): void => {
      const image = this.createElement("img", "") as HTMLImageElement;
      image.src = source; image.alt = this.i18n.t("ui.catalog.coverOf", { title: entry.name.trim() });
      image.decoding = "async"; image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => root.replaceChildren(placeholder), { once: true });
      root.replaceChildren(image);
    };
    const direct = this.covers.coverUrl(entry);
    if (direct) show(direct); else root.append(placeholder);
    if (!this.coverGenerator || (entry.format !== "cbr" && entry.format !== "cbz")) return Promise.resolve(null);
    return this.coverGenerator.resolve(this.collectionId, entry).then(asset => {
      if (!asset) return null;
      show(asset.dataUrl); onResolved(asset); return asset;
    });
  }

  private meta(root: HTMLElement, label: string, value: string): void {
    root.append(this.createElement("dt", "", label), this.createElement("dd", "", value));
  }
  private formatSize(bytes: number): string {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024) + " MB";
  }
}
