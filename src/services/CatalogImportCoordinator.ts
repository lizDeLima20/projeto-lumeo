import type { CatalogBookData } from "../models/CatalogBook";
import { LocalFileImporter } from "../importers/LocalFileImporter";
import type { Book } from "../models/Book";
import type { CoverService } from "./CoverService";
import type { ImportManager } from "./ImportManager";

export type CatalogImportStage = "preparing" | "downloading" | "validating" | "saving" | "complete";

/** Imports a file explicitly selected by the reader after a browser download. */
export class CatalogImportCoordinator {
  private readonly validator = new LocalFileImporter();
  public constructor(private readonly imports: ImportManager, private readonly covers: CoverService) {}
  public async addDownloadedFile(book: CatalogBookData, file: File, onStage: (stage: CatalogImportStage, progress?: number | null) => void, signal?: AbortSignal): Promise<Book> {
    onStage("validating"); const imported = await this.validator.import(file, "catalog");
    const cover = await this.covers.fromBookFile(imported.file, imported.fileType, book.title);
    onStage("saving");
    const saved = await this.imports.save(imported, { title: book.title, author: book.author, genreId: book.genreId,
      readingStatus: "unread", cover, volume: book.volume, series: book.collection, description: book.description }, undefined, { signal, catalogBookId: book.bookId });
    onStage("complete", 100); return saved;
  }

}
