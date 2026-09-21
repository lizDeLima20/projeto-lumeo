import type { DriveFolderEntry } from "./DriveCollectionService";

/** The cover of a comic in a published collection is its own first page: Drive renders
 *  that page for any file shared by link, so nothing is downloaded, rendered or uploaded
 *  to produce it.
 *
 *  Covers are resolved one at a time, only for the rows a reader actually reaches, and the
 *  resolved URL is kept per Drive file id. The bytes themselves are already kept by the
 *  service worker's cover cache, so a folder revisited offline still shows its covers. */
export class ComicCoverSource {
  private readonly urls = new Map<string, string>();
  public constructor(private readonly width = 320, private readonly height = 452) {}

  /** Only a supported PDF has a first page worth showing. */
  public hasCover(entry: DriveFolderEntry): boolean {
    return entry.kind === "file" && entry.supported && entry.format === "pdf";
  }

  public coverUrl(entry: DriveFolderEntry): string | null {
    if (!this.hasCover(entry)) return null;
    const cached = this.urls.get(entry.id);
    if (cached) return cached;
    const url = `https://drive.google.com/thumbnail?id=${encodeURIComponent(entry.id)}&sz=w${this.width}-h${this.height}`;
    this.urls.set(entry.id, url);
    return url;
  }

  public isCached(fileId: string): boolean { return this.urls.has(fileId); }
  public get size(): number { return this.urls.size; }
  public forget(): void { this.urls.clear(); }
}

/** Attaches covers as rows come into view. A folder with two hundred issues costs two
 *  hundred covers only if the reader actually scrolls past all of them. */
export class LazyCoverLoader {
  private readonly observer: IntersectionObserver | null;
  public constructor(private readonly covers: ComicCoverSource) {
    this.observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(entries => entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        this.reveal(entry.target as HTMLImageElement);
      }), { rootMargin: "200px" })
      : null;
  }

  public observe(image: HTMLImageElement, entry: DriveFolderEntry): void {
    const url = this.covers.coverUrl(entry);
    if (!url) return;
    image.dataset.coverUrl = url;
    // Without IntersectionObserver the browser's own lazy loading still holds the line.
    if (!this.observer) { this.reveal(image); return; }
    this.observer.observe(image);
  }

  public destroy(): void { this.observer?.disconnect(); }

  private reveal(image: HTMLImageElement): void {
    const url = image.dataset.coverUrl;
    if (!url || image.src) return;
    image.src = url;
    this.observer?.unobserve(image);
  }
}
