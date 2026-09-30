import { defaultComicCoverGenerator, type ComicCoverGenerator } from "./ComicCoverGenerator";
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
    return entry.kind === "file" && entry.supported &&
      (entry.format === "pdf" || ((entry.format === "cbr" || entry.format === "cbz") && Boolean(entry.thumbnailUrl)));
  }

  public coverUrl(entry: DriveFolderEntry): string | null {
    if (!this.hasCover(entry)) return null;
    // Drive's thumbnailLink is a 220px preview ("...=s220"); ask it for the size this
    // screen shows, or the details page stretches a thumbnail into a blurred cover.
    if (entry.thumbnailUrl) return entry.thumbnailUrl.replace(/=s\d+$/, `=s${Math.max(this.width, this.height)}`);
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
 *  hundred covers only if the reader actually scrolls past all of them.
 *
 *  A PDF, or a CBR/CBZ Drive already rendered a thumbnail for, just gets that URL. A
 *  CBR/CBZ with no thumbnail gets its cover generated on the same reveal - the comic's own
 *  first page, read lazily, cached locally, never blocking the card or the rest of the
 *  screen while it works. */
export class LazyCoverLoader {
  private readonly observer: IntersectionObserver | null;
  private readonly pending = new WeakMap<HTMLImageElement, () => void>();
  public constructor(private readonly covers: ComicCoverSource, private readonly generator: ComicCoverGenerator | null = defaultComicCoverGenerator()) {
    this.observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(entries => entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const image = entry.target as HTMLImageElement;
        this.observer?.unobserve(image);
        const start = this.pending.get(image);
        this.pending.delete(image);
        start?.();
      }), { rootMargin: "200px" })
      : null;
  }

  /** `onUnavailable` is the caller's placeholder - it runs immediately when neither a
   *  direct URL nor generation is possible, and later if generation is tried but fails. */
  public observe(image: HTMLImageElement, entry: DriveFolderEntry, onUnavailable?: () => void): void {
    const url = this.covers.coverUrl(entry);
    const canGenerate = !url && Boolean(this.generator) && entry.kind === "file" && entry.supported
      && (entry.format === "cbr" || entry.format === "cbz");
    if (!url && !canGenerate) { onUnavailable?.(); return; }
    const start = url
      ? () => { image.src = url; }
      : () => {
        void this.generator!.cover(entry, () => image.isConnected).then(dataUrl => {
          if (dataUrl) image.src = dataUrl; else onUnavailable?.();
        });
      };
    // Without IntersectionObserver the browser's own lazy loading still holds the line.
    if (!this.observer) { start(); return; }
    this.pending.set(image, start);
    this.observer.observe(image);
  }

  public destroy(): void { this.observer?.disconnect(); }
}
