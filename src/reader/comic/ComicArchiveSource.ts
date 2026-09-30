import { Archive } from "libarchive.js";
import type { PDFPageProxy } from "pdfjs-dist";
import { comicPageCollator, isComicPageImagePath, isSafeArchivePath, sniffComicPageMime } from "../../../shared/ComicArchiveEntryFilter";
import type { ComicPageSource } from "./ComicPageSource";
import type { ComicStageSize } from "./ComicPageEngine";

type ArchiveFile = { name: string; size: number; extract(): Promise<File> };
type ArchiveReader = Awaited<ReturnType<typeof Archive.open>>;
type Page = { path: string; file: ArchiveFile };
const MAX_ENTRIES = 3000;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_PAGE_BYTES = 50 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;
const MAX_CANVAS_PIXELS = 18_000_000;

/** One indexed image archive. Listing is cheap; only requested pages are decompressed. */
export class ComicArchiveSource implements ComicPageSource {
  private archive: ArchiveReader | null = null;
  private pages: Page[] = [];
  public constructor(private readonly expectedFormat?: "cbr" | "cbz") {}

  private readonly decoded = new Map<number, Blob>();
  private readonly canvases = new Map<string, HTMLCanvasElement>();
  private generation = 0;

  public async open(blob: Blob): Promise<number> {
    await this.close();
    if (blob.size <= 0 || blob.size > MAX_ARCHIVE_BYTES) throw new Error("HQ excede o limite de tamanho.");
    const header = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    const zip = header[0] === 0x50 && header[1] === 0x4b && header[2] === 3 && header[3] === 4;
    const rar = header[0] === 0x52 && header[1] === 0x61 && header[2] === 0x72 && header[3] === 0x21 && header[4] === 0x1a && header[5] === 0x07 && (header[6] === 0 || header[6] === 1);
    if (!zip && !rar) throw new Error("Arquivo de HQ inválido: assinatura ZIP/RAR ausente.");
    if ((this.expectedFormat === "cbr" && !rar) || (this.expectedFormat === "cbz" && !zip)) throw new Error("Arquivo de HQ não corresponde à extensão declarada.");
    Archive.init({ workerUrl: `${import.meta.env.BASE_URL}vendor/libarchive/worker-bundle.js` });
    const archive = await Archive.open(blob instanceof File ? blob : new File([blob], zip ? "comic.cbz" : "comic.cbr"));
    try {
      if (await archive.hasEncryptedData()) throw new Error("HQ protegida por senha não é suportada.");
      const listed = await archive.getFilesArray() as { path: string; file: ArchiveFile }[];
      if (listed.length > MAX_ENTRIES) throw new Error("HQ contém arquivos demais.");
      let expanded = 0;
      const pages: Page[] = [];
      for (const item of listed) {
        const path = `${item.path}${item.file.name}`.replace(/\\/g, "/");
        if (!isSafeArchivePath(path)) throw new Error("HQ contém caminho inseguro.");
        if (!isComicPageImagePath(path)) continue;
        if (!Number.isFinite(item.file.size) || item.file.size <= 0 || item.file.size > MAX_PAGE_BYTES) throw new Error("Página de HQ excede o limite de tamanho.");
        expanded += item.file.size;
        if (expanded > MAX_EXPANDED_BYTES || expanded / Math.max(blob.size, 1) > 150) throw new Error("HQ excede os limites de descompactação.");
        pages.push({ path, file: item.file });
      }
      if (!pages.length) throw new Error("HQ sem páginas JPEG, PNG ou WebP.");
      pages.sort((a, b) => comicPageCollator.compare(a.path, b.path));
      this.archive = archive; this.pages = pages;
      return pages.length;
    } catch (error) { await archive.close(); throw error; }
  }

  public get totalPages(): number { return this.pages.length; }
  public async page(_pageNumber: number): Promise<PDFPageProxy | null> { return null; }
  public async image(pageNumber: number): Promise<Blob> {
    const known = this.decoded.get(pageNumber); if (known) return known;
    const entry = this.pages[pageNumber - 1]; if (!entry) throw new Error("Página de HQ inexistente.");
    const file = await entry.file.extract();
    if (file.size <= 0 || file.size > MAX_PAGE_BYTES || file.size !== entry.file.size) throw new Error("Página da HQ incompleta ou excessiva.");
    const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const mime = sniffComicPageMime(header);
    const extension = entry.path.split(".").pop()?.toLowerCase();
    if (!mime || (extension === "jpg" || extension === "jpeg" ? mime !== "image/jpeg" : mime !== `image/${extension}`)) {
      throw new Error("Imagem da HQ não corresponde ao formato declarado.");
    }
    const image = new Blob([file], { type: mime });
    this.decoded.set(pageNumber, image);
    if (this.decoded.size > 3) this.decoded.delete(this.decoded.keys().next().value!);
    return image;
  }

  public async aspect(pageNumber: number): Promise<number | null> {
    const image = await createImageBitmap(await this.image(pageNumber));
    try { return image.height ? image.width / image.height : null; }
    finally { image.close(); }
  }

  public async render(pageNumber: number, stage: ComicStageSize): Promise<HTMLCanvasElement | null> {
    if (!this.pages[pageNumber - 1]) return null;
    const key = `${pageNumber}:${Math.round(stage.width)}x${Math.round(stage.height)}`;
    const known = this.canvases.get(key); if (known) return known;
    const generation = this.generation;
    const image = await createImageBitmap(await this.image(pageNumber));
    try {
      const scale = Math.max(0.05, Math.min(stage.width / image.width, stage.height / image.height));
      const ratio = Math.min(globalThis.devicePixelRatio || 1, 3, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, image.width * image.height * scale * scale)));
      const canvas = document.createElement("canvas");
      canvas.className = "comic-page__canvas";
      canvas.width = Math.max(1, Math.floor(image.width * scale * ratio));
      canvas.height = Math.max(1, Math.floor(image.height * scale * ratio));
      const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
      if (!context) return null;
      context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      if (generation === this.generation) {
        this.canvases.set(key, canvas);
        if (this.canvases.size > 8) this.canvases.delete(this.canvases.keys().next().value!);
      }
      return canvas;
    } finally { image.close(); }
  }

  public invalidate(): void { this.generation++; this.canvases.clear(); }
  public async close(): Promise<void> { this.invalidate(); this.decoded.clear(); this.pages = []; await this.archive?.close(); this.archive = null; }
}
