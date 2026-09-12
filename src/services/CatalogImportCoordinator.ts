import type { CatalogBookData } from "../models/CatalogBook";
import { LocalFileImporter } from "../importers/LocalFileImporter";
import type { Book } from "../models/Book";
import type { CatalogDownloadLink, CatalogService } from "./CatalogService";
import type { CoverService } from "./CoverService";
import type { ImportManager } from "./ImportManager";

export type CatalogImportStage = "preparing" | "downloading" | "validating" | "saving" | "complete";

/** Downloads a single selected catalogue item and commits it through ImportManager. */
export class CatalogImportCoordinator {
  private readonly validator = new LocalFileImporter();
  public constructor(private readonly catalog: CatalogService, private readonly imports: ImportManager, private readonly covers: CoverService) {}
  public async add(book: CatalogBookData, onStage: (stage: CatalogImportStage, progress?: number | null) => void, signal?: AbortSignal): Promise<Book> {
    onStage("preparing");
    const download = await this.catalog.downloadLink(book.bookId);
    const file = await this.downloadDirectly(download, onStage, signal);
    onStage("validating"); const imported = await this.validator.import(file, "catalog");
    const cover = await this.covers.fromBookFile(imported.file, imported.fileType, book.title);
    onStage("saving");
    const saved = await this.imports.save(imported, { title: book.title, author: book.author, genreId: book.genreId,
      readingStatus: "unread", cover, volume: book.volume, series: book.collection, description: book.description }, undefined, { signal, catalogBookId: book.bookId });
    onStage("complete", 100); return saved;
  }

  private async downloadDirectly(download: CatalogDownloadLink, onStage: (stage: CatalogImportStage, progress?: number | null) => void, signal?: AbortSignal): Promise<File> {
    let response: Response;
    try { response = await fetch(download.downloadUrl, { signal, credentials: "omit" }); }
    catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new Error("Não foi possível baixar o livro diretamente do Google Drive.");
    }
    if (!response.ok) throw new Error("O livro não está disponível para download no Google Drive.");
    const length = Number(response.headers.get("content-length")) || download.fileSize || 0;
    const chunks: BlobPart[] = []; let received = 0;
    const reader = response.body?.getReader();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        if (value) { chunks.push(value); received += value.byteLength; onStage("downloading", length ? Math.min(100, Math.round(received / length * 100)) : null); }
      }
    } else chunks.push(await response.blob());
    const mime = download.format === "pdf" ? "application/pdf" : "application/epub+zip";
    const file = new File(chunks, `${download.title}.${download.format}`, { type: mime });
    if (download.sha256 && await this.sha256(file) !== download.sha256.toLowerCase()) throw new Error("A validação de segurança do arquivo falhou.");
    return file;
  }

  private async sha256(file: Blob): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }
}
