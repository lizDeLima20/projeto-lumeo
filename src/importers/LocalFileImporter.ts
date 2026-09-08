import type { BookFileType } from "../models/Book";
import { FileSecurityValidator } from "../security/FileSecurityValidator";
import { ZipSecurityValidator } from "../security/ZipSecurityValidator";
import type { BookImporter, ImportedFile } from "./BookImporter";

export class UnsupportedFileError extends Error {}

export class LocalFileImporter implements BookImporter {
  public constructor(private readonly fileSecurity = new FileSecurityValidator(), private readonly zipSecurity = new ZipSecurityValidator()) {}
  private readonly mimeTypes: Record<BookFileType, readonly string[]> = {
    pdf: ["application/pdf", "application/octet-stream"],
    epub: ["application/epub+zip", "application/octet-stream"],
  };
  public async import(file: File, source: ImportedFile["source"] = "device"): Promise<ImportedFile> {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "pdf" && extension !== "epub") {
      throw new UnsupportedFileError("Formato não suportado. Escolha um arquivo PDF ou EPUB.");
    }
    if (file.type && !this.mimeTypes[extension].includes(file.type)) {
      throw new UnsupportedFileError(`O conteúdo do arquivo não corresponde ao formato ${extension.toUpperCase()}.`);
    }
    if (file.size === 0) throw new UnsupportedFileError("O arquivo selecionado está vazio.");
    try {
      await this.fileSecurity.validate(file, extension);
      if (extension === "epub") this.zipSecurity.validate(new Uint8Array(await file.arrayBuffer()));
    } catch {
      throw new UnsupportedFileError(`O conteúdo do arquivo não corresponde ao formato ${extension.toUpperCase()}.`);
    }
    return { file, fileType: extension, suggestedTitle: file.name.replace(/\.(pdf|epub)$/i, "").replace(/[_-]+/g, " ").trim(),
      source, originalName: file.name, mimeType: file.type, size: file.size };
  }
}
