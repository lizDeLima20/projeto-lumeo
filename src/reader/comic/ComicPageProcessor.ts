import { ComicBlockStyleSampler, type SampledPixels } from "./ComicBlockStyleSampler";
import { ComicPageBlockCache } from "./ComicPageBlockCache";
import { ComicTextBlockGrouper, type ComicFragmentCluster } from "./ComicTextBlockGrouper";
import type { ComicPageSample, ComicTextFragmentSource } from "./ComicTextFragmentSource";
import type { ComicPageBlocks, ComicTextBlock, ComicTextSourceName } from "./ComicTextTypes";

/** Finds the tappable regions of one page, in the background, after the page is already on
 *  screen. Sources are tried in order and the first one that finds text wins, so a comic
 *  with real lettering never pays for OCR.
 *
 *  It never throws: a page whose text cannot be found is simply a page with no blocks, and
 *  the comic stays readable. */
export class ComicPageProcessor {
  public constructor(
    private readonly sources: readonly ComicTextFragmentSource[],
    private readonly cache = new ComicPageBlockCache(),
    private readonly grouper = new ComicTextBlockGrouper(),
    private readonly sampler = new ComicBlockStyleSampler(),
  ) {}

  public cached(pageNumber: number): ComicPageBlocks | null { return this.cache.get(pageNumber); }
  public isProcessed(pageNumber: number): boolean { return this.cache.has(pageNumber); }
  public forget(): void { this.cache.clear(); }
  public async dispose(): Promise<void> { for (const source of this.sources) await source.dispose?.().catch(() => undefined); }

  public async process(sample: ComicPageSample, signal?: AbortSignal): Promise<ComicPageBlocks> {
    const cached = this.cache.get(sample.pageNumber); if (cached) return cached;
    let blocks: ComicTextBlock[] = []; let source: ComicTextSourceName = "none";
    for (const candidate of this.sources) {
      if (signal?.aborted) break;
      try {
        if (!await candidate.available()) continue;
        const fragments = await candidate.fragments(sample, signal);
        if (!fragments.length) continue;
        const built = this.build(sample, this.grouper.group(fragments));
        if (!built.length) continue;
        blocks = built; source = candidate.name; break;
      } catch { /* one source failing must not cost the reader the page */ }
    }
    const value: ComicPageBlocks = { pageNumber: sample.pageNumber, blocks, source };
    if (!signal?.aborted) this.cache.set(value);
    return value;
  }

  private build(sample: ComicPageSample, clusters: readonly ComicFragmentCluster[]): ComicTextBlock[] {
    return clusters.filter(cluster => this.worthTapping(cluster)).map((cluster, index) => {
      const region = { x: cluster.x, y: cluster.y, width: cluster.width, height: cluster.height };
      const style = this.sampler.sample(this.pixels(sample.canvas, region), { x: 0, y: 0, width: 1, height: 1 });
      return {
        id: `p${sample.pageNumber}-b${index}`, pageNumber: sample.pageNumber,
        text: cluster.text, lines: cluster.lines, confidence: cluster.confidence,
        ...region, background: style.background, ink: style.ink,
        shape: this.sampler.shape(region, cluster.lines.length),
      };
    });
  }

  /** Drops the noise: a stray character, a speck, and the page-sized rectangle a text PDF
   *  produces when its whole body is one region. */
  private worthTapping(cluster: ComicFragmentCluster): boolean {
    return cluster.text.trim().length >= 2 && cluster.width >= 0.015 && cluster.height >= 0.006 && cluster.width * cluster.height <= 0.7;
  }

  private pixels(canvas: HTMLCanvasElement | null, region: { x: number; y: number; width: number; height: number }): SampledPixels | null {
    if (!canvas?.width || !canvas.height) return null;
    const left = Math.max(0, Math.floor(region.x * canvas.width)), top = Math.max(0, Math.floor(region.y * canvas.height));
    const width = Math.min(canvas.width - left, Math.max(2, Math.ceil(region.width * canvas.width)));
    const height = Math.min(canvas.height - top, Math.max(2, Math.ceil(region.height * canvas.height)));
    if (width < 2 || height < 2) return null;
    try { return canvas.getContext("2d", { willReadFrequently: true })?.getImageData(left, top, width, height) ?? null; }
    catch { return null; }
  }
}
