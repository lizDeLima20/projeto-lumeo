import type { CatalogBookData } from "../models/CatalogBook";
import { LocalFileImporter } from "../importers/LocalFileImporter";
import type { Book } from "../models/Book";
import type { CatalogService } from "./CatalogService";
import type { CoverService } from "./CoverService";
import type { ImportManager } from "./ImportManager";

export type CatalogImportStage = "preparing" | "downloading" | "validating" | "saving" | "complete";

/** Downloads a single selected catalogue item and commits it through ImportManager. */
export class CatalogImportCoordinator {
  private readonly validator = new LocalFileImporter();
  public constructor(private readonly catalog: CatalogService, private readonly imports: ImportManager, private readonly covers: CoverService) {}
  public async add(book: CatalogBookData, onStage: (stage: CatalogImportStage, progress?: number | null) => void, signal?: AbortSignal): Promise<Book> {
    onStage("preparing");
    const file = await this.catalog.download(book.bookId, (progress) => onStage("downloading", progress), signal);
    onStage("validating"); const imported = await this.validator.import(file, "catalog");
    const cover = await this.covers.fromBookFile(imported.file, imported.fileType, book.title);
    onStage("saving");
    const saved = await this.imports.save(imported, { title: book.title, author: book.author, genreId: book.genreId,
      readingStatus: "unread", cover, volume: book.volume, series: book.collection, description: book.description }, undefined, { signal, catalogBookId: book.bookId });
    onStage("complete", 100); return saved;
  }
}
