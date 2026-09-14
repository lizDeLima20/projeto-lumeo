import type { CatalogBookData } from "../models/CatalogBook";
import { LocalFileImporter } from "../importers/LocalFileImporter";
import type { Book } from "../models/Book";
import type { CatalogDownloadLink } from "./CatalogService";
import type { CoverService } from "./CoverService";
import type { ImportManager } from "./ImportManager";

export type CatalogImportStage = "preparing" | "downloading" | "validating" | "saving" | "complete";
export class CatalogImportFileMismatchError extends Error {
  public readonly code = "IMPORT_FILE_INVALID";
  public constructor() { super("O arquivo selecionado não corresponde ao livro do catálogo."); }
}

/** Imports a file explicitly selected by the reader after a browser download. */
export class CatalogImportCoordinator {
  private readonly validator = new LocalFileImporter();
  public constructor(private readonly imports: ImportManager, private readonly covers: CoverService) {}
  public async addDownloadedFile(book: CatalogBookData, download: CatalogDownloadLink, file: File, onStage: (stage: CatalogImportStage, progress?: number | null) => void, signal?: AbortSignal): Promise<Book> {
    onStage("validating"); const imported = await this.validator.import(file, "catalog"); await this.assertMatches(download, imported.file);
    const cover = await this.covers.fromBookFile(imported.file, imported.fileType, book.title);
    onStage("saving");
    const saved = await this.imports.save(imported, { title: book.title, author: book.author, genreId: book.genreId,
      readingStatus: "unread", cover, volume: book.volume, series: book.collection, description: book.description }, undefined, { signal, catalogBookId: book.bookId });
    onStage("complete", 100); return saved;
  }

  private async assertMatches(download: CatalogDownloadLink, file: File): Promise<void> {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== download.format) throw new CatalogImportFileMismatchError();
    if (download.fileSize !== null && download.fileSize !== undefined && file.size !== download.fileSize) throw new CatalogImportFileMismatchError();
    if (download.sha256 && typeof crypto !== "undefined" && crypto.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const actual = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
      if (actual.toLowerCase() !== download.sha256.toLowerCase()) throw new CatalogImportFileMismatchError();
      // The checksum is the content identity. Browser collision suffixes such
      // as " (1)" must not prevent importing the same catalog file.
      return;
    }
    // Older catalog rows can lack a checksum. Keep a conservative fallback so
    // they remain usable, but only tolerate the browser's numeric collision
    // suffix and never treat a different base filename as the same book.
    if (this.normalizedName(this.withoutBrowserCopySuffix(file.name)) !== this.normalizedName(download.expectedFilename)) {
      throw new CatalogImportFileMismatchError();
    }
  }
  private withoutBrowserCopySuffix(value: string): string {
    return value.replace(/\s*\(\d+\)(?=\.[^.]+$)/, "");
  }
  private normalizedName(value: string): string {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/-+/g, "-");
  }

}
