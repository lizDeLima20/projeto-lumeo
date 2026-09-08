import type { ImportedFile } from "./BookImporter";
import { GoogleDriveUrlParser } from "./GoogleDriveUrlParser";
import { LocalFileImporter } from "./LocalFileImporter";

export class FolderUrlError extends Error { public constructor(public readonly folderId: string) { super("Este link aponta para uma pasta. Escolha um arquivo dentro dela."); } }
export class InvalidUrlError extends Error {}
export interface AuthenticatedDriveDownloader { downloadFile(fileId: string, onProgress?: (percent: number | null) => void): Promise<File>; }

export class UrlImporter {
  public constructor(private readonly validator = new LocalFileImporter(), private readonly parser = new GoogleDriveUrlParser(),
    private readonly drive?: AuthenticatedDriveDownloader, private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 30_000) {}
  public async importFromUrl(value: string | URL, onProgress?: (percent: number | null) => void): Promise<ImportedFile> {
    let url: URL; try { url = value instanceof URL ? value : new URL(value.trim()); } catch { throw new InvalidUrlError("Informe um link válido para um arquivo PDF ou EPUB."); }
    const parsed = this.parser.parse(url);
    if (parsed.kind === "folder") throw new FolderUrlError(parsed.folderId);
    if (parsed.kind === "file") {
      if (!this.drive) throw new Error("Este arquivo do Google Drive requer a configuração do acesso Google.");
      return this.validator.import(await this.drive.downloadFile(parsed.fileId, onProgress), "url");
    }
    if (url.protocol !== "https:" && !(import.meta.env.DEV && url.protocol === "http:")) throw new InvalidUrlError("Use um link HTTPS válido.");
    const controller = new AbortController(); const timeout = globalThis.setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, { signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Este arquivo exige autorização. Use o Google Drive para entrar." : "Não foi possível baixar o arquivo pelo link.");
      const blob = await this.readResponse(response, onProgress); const name = this.fileName(response, url, blob.type);
      return this.validator.import(new File([blob], name, { type: blob.type || this.mimeFromName(name) }), "url");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw new Error("O download demorou demais. Tente novamente.");
      throw error;
    } finally { globalThis.clearTimeout(timeout); }
  }
  private async readResponse(response: Response, onProgress?: (percent: number | null) => void): Promise<Blob> {
    const total = Number(response.headers.get("content-length")) || 0; if (!response.body) return response.blob();
    const reader = response.body.getReader(); const chunks: BlobPart[] = []; let received = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; if (value) { chunks.push(new Uint8Array(value).buffer); received += value.byteLength; onProgress?.(total ? Math.round(received / total * 100) : null); } }
    return new Blob(chunks, { type: response.headers.get("content-type")?.split(";")[0] ?? "" });
  }
  private fileName(response: Response, url: URL, mime: string): string {
    const disposition = response.headers.get("content-disposition") ?? "";
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]; const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    const raw = encoded ? decodeURIComponent(encoded) : plain ?? decodeURIComponent(url.pathname.split("/").pop() ?? "");
    if (/\.(pdf|epub)$/i.test(raw)) return raw; if (mime === "application/pdf") return `${raw || "livro"}.pdf`;
    if (mime === "application/epub+zip") return `${raw || "livro"}.epub`; return raw || "arquivo";
  }
  private mimeFromName(name: string): string { return name.toLowerCase().endsWith(".pdf") ? "application/pdf" : name.toLowerCase().endsWith(".epub") ? "application/epub+zip" : ""; }
}
