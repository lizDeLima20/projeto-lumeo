import type { BookFileType } from "../models/Book";
import { ComicArchiveSource } from "../reader/comic/ComicArchiveSource";
import { FileSecurityValidator } from "../security/FileSecurityValidator";
import { ZipSecurityValidator } from "../security/ZipSecurityValidator";
import type { BookImporter, ImportedFile } from "./BookImporter";

export class UnsupportedFileError extends Error {}

export class LocalFileImporter implements BookImporter {
  public constructor(private readonly fileSecurity = new FileSecurityValidator(), private readonly zipSecurity = new ZipSecurityValidator()) {}
  private readonly mimeTypes: Record<BookFileType, readonly string[]> = {
    pdf: ["application/pdf", "application/octet-stream"],
    epub: ["application/epub+zip", "application/octet-stream"],
    // Drive content-sniffs a lot of real CBR/CBZ uploads down to the bare archive type - the
    // same application/x-rar and application/rar DriveEntryClassifier already recognizes as
    // CBR server-side. A downloaded file keeps that mimeType, so the import check needs to
    // accept it too, or a real CBR from Drive gets rejected here as "wrong content".
    cbr: ["application/x-cbr", "application/vnd.comicbook-rar", "application/x-rar-compressed", "application/x-rar", "application/rar", "application/vnd.rar", "application/octet-stream"],
    cbz: ["application/x-cbz", "application/vnd.comicbook+zip", "application/zip", "application/x-zip-compressed", "application/octet-stream"],
  };
  public async import(file: File, source: ImportedFile["source"] = "device"): Promise<ImportedFile> {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "pdf" && extension !== "epub" && extension !== "cbr" && extension !== "cbz") {
      throw new UnsupportedFileError("Formato não suportado. Escolha PDF, EPUB, CBR ou CBZ.");
    }
    if (file.type && !this.mimeTypes[extension].includes(file.type)) {
      throw new UnsupportedFileError(`O conteúdo do arquivo não corresponde ao formato ${extension.toUpperCase()}.`);
    }
    if (file.size === 0) throw new UnsupportedFileError("O arquivo selecionado está vazio.");
    try {
      if (extension === "pdf" || extension === "epub") await this.fileSecurity.validate(file, extension);
      if (extension === "cbr" || extension === "cbz") {
        const archive = new ComicArchiveSource(extension);
        try { await archive.open(file); }
        finally { await archive.close(); }
      }
      if (extension === "epub") this.zipSecurity.validate(new Uint8Array(await file.arrayBuffer()));
    } catch {
      throw new UnsupportedFileError(`O conteúdo do arquivo não corresponde ao formato ${extension.toUpperCase()}.`);
    }
    return { file, fileType: extension, suggestedTitle: file.name.replace(/\.(pdf|epub|cbr|cbz)$/i, "").replace(/[_-]+/g, " ").trim(),
      source, originalName: file.name, mimeType: file.type, size: file.size };
  }
}
