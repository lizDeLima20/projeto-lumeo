import type { ComicPageSample, ComicTextFragmentSource } from "./ComicTextFragmentSource";
import type { ComicTextFragment, ComicTextSourceName } from "./ComicTextTypes";

export interface ComicOcrAssets { manifestPath: string; workerPath: string; corePath: string; langPath: string; languages: string; }

/** Everything OCR needs is served from the app's own origin: no page ever leaves the
 *  device, and the strict connect-src CSP stays intact. `npm run ocr:assets` fills this
 *  folder; until it does, `available()` answers false and comics simply read without
 *  tappable blocks. */
export const DEFAULT_COMIC_OCR_ASSETS: ComicOcrAssets = {
  manifestPath: "/ocr/manifest.json", workerPath: "/ocr/worker.min.js", corePath: "/ocr/core",
  langPath: "/ocr/lang", languages: "por",
};

interface TesseractLikeWorker {
  setParameters(parameters: Record<string, unknown>): Promise<unknown>;
  recognize(image: unknown, options?: unknown, output?: unknown): Promise<{ data: { blocks?: unknown } }>;
  terminate(): Promise<unknown>;
}
interface TesseractModule { createWorker(languages?: unknown, oem?: unknown, options?: unknown): Promise<TesseractLikeWorker>; }
interface RecognizedBox { bbox?: { x0: number; y0: number; x1: number; y1: number }; text?: string; confidence?: number; }
interface RecognizedLine extends RecognizedBox { words?: RecognizedBox[] }
interface RecognizedParagraph { lines?: RecognizedLine[] }
interface RecognizedBlock { paragraphs?: RecognizedParagraph[] }

/** Local Tesseract (WebAssembly), loaded only when a page has no text layer and only once
 *  per reading session. Scanned comics are the case it exists for. */
export class TesseractComicOcrSource implements ComicTextFragmentSource {
  public readonly name: ComicTextSourceName = "ocr";
  private worker: TesseractLikeWorker | null = null;
  private starting: Promise<TesseractLikeWorker | null> | null = null;
  private assetCheck: Promise<boolean> | null = null;
  private readonly maxOcrSide = 1800;
  private readonly startTimeoutMs = 20_000;
  private packagedLanguages: string | null = null;
  private unavailable = false;

  public constructor(private readonly assets: ComicOcrAssets = DEFAULT_COMIC_OCR_ASSETS) {}

  public available(): Promise<boolean> {
    if (this.unavailable) return Promise.resolve(false);
    this.assetCheck ??= this.probeAssets();
    return this.assetCheck;
  }

  public async fragments(sample: ComicPageSample, signal?: AbortSignal): Promise<ComicTextFragment[]> {
    const canvas = sample.canvas; if (!canvas || !canvas.width || !canvas.height) return [];
    if (!await this.available()) return [];
    const worker = await this.start(); if (!worker || signal?.aborted) return [];
    const prepared = this.prepare(canvas) ?? canvas;
    const result = await worker.recognize(prepared, {}, { blocks: true, text: false });
    if (signal?.aborted) return [];
    return this.toFragments(result?.data?.blocks, prepared.width, prepared.height);
  }

  /** Comic art is the worst case for Tesseract: saturated colour everywhere, lettering that
   *  is sometimes light on dark. Measured on a colour page, recognizing the canvas as drawn
   *  returns noise at ~42% confidence; the same page in greyscale, at a declared DPI,
   *  returns every line at 94-96%. Long side is capped because a larger bitmap costs time
   *  without buying accuracy. The page on screen is never touched - this is a copy. */
  private prepare(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
    try {
      const longest = Math.max(canvas.width, canvas.height);
      const scale = longest > this.maxOcrSide ? this.maxOcrSide / longest : 1;
      const target = document.createElement("canvas");
      target.width = Math.round(canvas.width * scale); target.height = Math.round(canvas.height * scale);
      const context = target.getContext("2d", { willReadFrequently: true }); if (!context) return null;
      context.drawImage(canvas, 0, 0, target.width, target.height);
      const image = context.getImageData(0, 0, target.width, target.height);
      for (let index = 0; index < image.data.length; index += 4) {
        const luma = 0.2126 * image.data[index]! + 0.7152 * image.data[index + 1]! + 0.0722 * image.data[index + 2]!;
        image.data[index] = image.data[index + 1] = image.data[index + 2] = luma;
      }
      context.putImageData(image, 0, 0);
      return target;
    } catch { return null; }
  }

  public async dispose(): Promise<void> {
    const worker = this.worker; this.worker = null; this.starting = null;
    try { await worker?.terminate(); } catch { /* a worker that is already gone needs no closing */ }
  }

  /** One small GET, not a HEAD on the multi-megabyte language file: the packaged app is
   *  served by Capacitor's local server, where a HEAD is not worth relying on, and a GET of
   *  the real asset would pull megabytes just to ask a yes/no question. */
  private async probeAssets(): Promise<boolean> {
    if (typeof fetch !== "function") return false;
    try {
      const response = await fetch(this.assets.manifestPath, { cache: "force-cache" });
      if (!response.ok) return false;
      const manifest = await response.json() as { languages?: unknown };
      const languages = Array.isArray(manifest.languages) ? manifest.languages.filter((value): value is string => typeof value === "string") : [];
      if (!languages.length) return false;
      this.packagedLanguages = languages.join("+");
      return true;
    } catch { return false; }
  }

  /** A worker that cannot start must fail, not hang. When wasm compilation is refused - a
   *  CSP without 'wasm-unsafe-eval', a corrupted core file - Tesseract neither resolves nor
   *  rejects, and without this bound the page's background pass would wait forever. */
  private start(): Promise<TesseractLikeWorker | null> {
    this.starting ??= Promise.race([
      this.createWorker(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), this.startTimeoutMs)),
    ]).then(worker => { if (!worker) this.unavailable = true; return worker; });
    return this.starting;
  }

  private async createWorker(): Promise<TesseractLikeWorker | null> {
    try {
      const loaded = await import("tesseract.js") as unknown as TesseractModule & { default?: TesseractModule };
      const createWorker = loaded.createWorker ?? loaded.default?.createWorker;
      if (!createWorker) return null;
      const worker = await createWorker(this.packagedLanguages ?? this.assets.languages, 1, {
        workerPath: this.assets.workerPath, corePath: this.assets.corePath, langPath: this.assets.langPath,
        // The packaged language files are plain .traineddata: Android's asset packager
        // gunzips and renames anything ending in .gz, so asking for the .gz name would 404
        // on the phone while working on the web.
        cacheMethod: "none", legacyCore: false, legacyLang: false, gzip: false,
      });
      // Automatic page segmentation, not sparse-text mode. Sparse text looked like the
      // obvious fit for scattered balloons and works on a desktop, but measured on an
      // Android device it returned nothing at all for pages holding a single balloon,
      // while automatic read every page. The DPI has to be declared either way: without it
      // Tesseract guesses from the bitmap and its guess on a rendered page is poor.
      await worker.setParameters({ tessedit_pageseg_mode: "3", user_defined_dpi: "300" });
      this.worker = worker; return worker;
    } catch { this.starting = null; return null; }
  }

  private toFragments(blocks: unknown, width: number, height: number): ComicTextFragment[] {
    if (!Array.isArray(blocks)) return [];
    const fragments: ComicTextFragment[] = [];
    (blocks as RecognizedBlock[]).forEach(block => (block.paragraphs ?? []).forEach(paragraph => (paragraph.lines ?? []).forEach(line => {
      const text = (line.text ?? "").trim(); const box = line.bbox;
      if (!text || !box) return;
      fragments.push({
        text, confidence: line.confidence,
        x: box.x0 / width, y: box.y0 / height,
        width: (box.x1 - box.x0) / width, height: (box.y1 - box.y0) / height,
      });
    })));
    return fragments;
  }
}
