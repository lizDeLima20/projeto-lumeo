import type { DriveFolderEntry, DriveFolderListing } from "./DriveCollectionService";

export interface ComicMetadata {
  title: string | null;
  series: string | null;
  number: string | null;
  year: string | null;
  writer: string | null;
  publisher: string | null;
  genre: string | null;
  summary: string | null;
}

export const EMPTY_COMIC_METADATA: ComicMetadata = {
  title: null, series: null, number: null, year: null, writer: null,
  publisher: null, genre: null, summary: null,
};

export interface ComicPresentation {
  title: string;
  author: string;
  series?: string;
  number?: string;
  year?: number;
  summary?: string;
}

/** Builds reader-facing comic metadata without ever using a filename as identity. */
export class ComicPresentationService {
  public present(entry: DriveFolderEntry, listing: Pick<DriveFolderListing, "breadcrumb">, metadata: ComicMetadata = EMPTY_COMIC_METADATA): ComicPresentation {
    const filename = this.filenameTitle(entry.name);
    const context = this.seriesContext(listing.breadcrumb.map(step => step.name));
    const number = this.issueNumber(metadata.number) ?? this.issueNumber(filename);
    const series = this.text(metadata.series) ?? context.series;
    const explicitTitle = this.text(metadata.title);
    const title = explicitTitle ?? (series && number ? `${series} #${number}` : this.contextualTitle(filename, context.label ?? series));
    const year = this.year(metadata.year) ?? context.year;
    return {
      title,
      author: this.text(metadata.writer) ?? "",
      ...(series ? { series } : {}),
      ...(number ? { number } : {}),
      ...(year ? { year } : {}),
      ...(this.text(metadata.summary) ? { summary: this.text(metadata.summary)! } : {}),
    };
  }

  private contextualTitle(filename: string, series?: string): string {
    if (!series || filename.toLocaleLowerCase().includes(series.toLocaleLowerCase())) return filename;
    return `${series} — ${filename}`;
  }

  private filenameTitle(name: string): string {
    return name.replace(/\.(pdf|epub|cbr|cbz)$/i, "").trim() || name.trim();
  }

  private issueNumber(value: string | null): string | null {
    const text = this.text(value);
    if (!text) return null;
    const pure = /^0*(\d+)(?:\.0+)?$/.exec(text);
    return pure ? String(Number(pure[1])) : null;
  }

  private seriesContext(names: readonly string[]): { series?: string; label?: string; year?: number } {
    const cleaned: string[] = [];
    let year: number | undefined;
    for (const raw of names.slice(1)) {
      year ??= this.year(/^\s*\[(\d{4})/.exec(raw)?.[1] ?? null) ?? undefined;
      const value = raw
        .replace(/^\s*\[[^\]]+\]\s*[-–—]?\s*/u, "")
        .replace(/\s*[-–—]\s*(?:volume|vol\.?)[\s_-]*\d+\s*$/iu, "")
        .trim();
      if (value && !/^(?:volume|vol\.?)\s*\d+$/iu.test(value)) cleaned.push(value);
    }
    return { ...(cleaned[0] ? { series: cleaned[0] } : {}), ...(cleaned.at(-1) ? { label: cleaned.at(-1)! } : {}), ...(year ? { year } : {}) };
  }

  private year(value: string | null): number | null {
    const text = this.text(value);
    if (!text || !/^\d{4}$/.test(text)) return null;
    const year = Number(text);
    return year >= 1000 && year <= 9999 ? year : null;
  }

  private text(value: string | null | undefined): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
}
