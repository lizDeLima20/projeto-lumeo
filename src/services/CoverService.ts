import { strFromU8, unzipSync } from "fflate";
import type { BookFileType } from "../models/Book";

export class CoverService {
  public async fromImage(file: File | null): Promise<string> {
    if (!file) return "";
    if (!file.type.startsWith("image/")) throw new Error("Escolha uma imagem válida para a capa.");
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Não foi possível processar a capa."));
      reader.readAsDataURL(file);
    });
  }

  public async fromBookFile(file: File, fileType: BookFileType, title: string): Promise<string> {
    try { return fileType === "pdf" ? await this.fromBlob(await (await import("./PdfCoverExtractor")).PdfCoverExtractor.extract(file)) : await this.fromEpub(file); }
    catch { return this.placeholder(title, fileType); }
  }

  public async fromBlob(blob: Blob): Promise<string> {
    if (!blob.type.startsWith("image/")) throw new Error("A capa extraída não é uma imagem válida.");
    return this.readAsDataUrl(await this.thumbnail(blob));
  }

  public placeholder(title: string, fileType: BookFileType): string {
    const initials = (title.trim().match(/[\p{L}\p{N}]+/gu) ?? ["Livro"]).slice(0, 2).map((word) => word[0]?.toLocaleUpperCase()).join("");
    const accent = fileType === "pdf" ? "%23725fd0" : "%23cc6c4c"; const safe = this.escapeXml(initials || "L");
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${decodeURIComponent(accent)}"/><stop offset="1" stop-color="#24194f"/></linearGradient></defs><rect width="600" height="900" rx="26" fill="url(#g)"/><path d="M70 100h8v700h-8z" fill="#fff" opacity=".28"/><circle cx="300" cy="410" r="116" fill="#fff" opacity=".1"/><text x="300" y="450" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif" font-size="126" font-weight="800">${safe}</text><text x="300" y="760" text-anchor="middle" fill="#fff" opacity=".72" font-family="system-ui,sans-serif" font-size="30" letter-spacing="8">LUMEO</text></svg>`)}`;
  }

  private async fromEpub(file: File): Promise<string> {
    const files = unzipSync(new Uint8Array(await file.arrayBuffer())); const container = files["META-INF/container.xml"];
    if (!container) throw new Error("EPUB sem container."); const containerXml = strFromU8(container); const opfPath = this.attribute(containerXml.match(/<rootfile\b[^>]*>/i)?.[0] ?? "", "full-path");
    if (!opfPath || !files[opfPath]) throw new Error("Pacote EPUB inválido."); const opf = strFromU8(files[opfPath]!); const coverId = this.attribute(opf.match(/<meta\b[^>]*name=["']cover["'][^>]*>/i)?.[0] ?? "", "content");
    const items = opf.match(/<item\b[^>]*>/gi) ?? []; const coverItem = items.find((tag) => this.attribute(tag, "properties").split(/\s+/).includes("cover-image"))
      ?? items.find((tag) => coverId && this.attribute(tag, "id") === coverId);
    if (!coverItem) throw new Error("EPUB sem capa declarada."); const href = this.attribute(coverItem, "href"); const mime = this.attribute(coverItem, "media-type");
    const coverPath = this.resolveArchivePath(opfPath, href); const bytes = files[coverPath]; if (!bytes || !mime.startsWith("image/")) throw new Error("Capa do EPUB inválida.");
    return this.fromBlob(new Blob([new Uint8Array(bytes).buffer], { type: mime }));
  }
  private attribute(tag: string, name: string): string { const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return tag.match(new RegExp(`${escaped}=["']([^"']+)["']`, "i"))?.[1] ?? ""; }
  private resolveArchivePath(opfPath: string, href: string): string { const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
    return decodeURIComponent(new URL(href, `https://epub.local/${base}`).pathname.slice(1)); }
  private async thumbnail(blob: Blob): Promise<Blob> {
    if (typeof createImageBitmap !== "function") return blob; const bitmap = await createImageBitmap(blob); const scale = Math.min(1, 600 / bitmap.width, 900 / bitmap.height);
    if (scale === 1) { bitmap.close(); return blob; } const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close(); return new Promise((resolve) => canvas.toBlob((result) => resolve(result ?? blob), "image/jpeg", .84));
  }
  private readAsDataUrl(blob: Blob): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Não foi possível salvar a capa.")); reader.readAsDataURL(blob); }); }
  private escapeXml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!); }
}
