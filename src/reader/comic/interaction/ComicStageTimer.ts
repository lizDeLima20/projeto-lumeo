/** The stages one page goes through, in the order they happen. */
export type ComicStage =
  | "PDF_RENDER" | "ASSET_ENCODING" | "BITMAP_CREATE" | "CONTAINER_DETECTION"
  | "TEXT_DETECTION" | "REGION_CROP" | "OCR" | "MASK_GENERATION" | "INDEXEDDB_WRITE";

export interface ComicStageRecorder {
  /** Times `work` and files it under `stage`. Repeated calls add up. */
  step<T>(stage: ComicStage, work: () => T | Promise<T>): Promise<T>;
  /** Files a duration measured elsewhere. */
  add(stage: ComicStage, milliseconds: number): void;
  /** Counts something worth counting next to the times, such as recognition calls. */
  count(name: string, amount?: number): void;
}

const now = (): number => (typeof performance === "object" ? performance.now() : Date.now());

/** Where a page's time actually goes.
 *
 *  A conversion that takes twelve seconds a page on a desktop and three and a half minutes
 *  on a phone is not slow in some general way: one stage is. Each stage is timed on the
 *  device that runs it and reported as one line per page, so the answer comes from the
 *  phone rather than from a guess about the phone. */
export class ComicStageTimer implements ComicStageRecorder {
  private readonly stages = new Map<ComicStage, number>();
  private readonly counters = new Map<string, number>();
  private readonly begun = now();

  public async step<T>(stage: ComicStage, work: () => T | Promise<T>): Promise<T> {
    const started = now();
    try { return await work(); }
    finally { this.add(stage, now() - started); }
  }

  public add(stage: ComicStage, milliseconds: number): void {
    this.stages.set(stage, (this.stages.get(stage) ?? 0) + milliseconds);
  }

  public count(name: string, amount = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
  }

  /** One line per page: the stages, the page, and what the page held. */
  public report(details: {
    pageIndex: number; sourceWidth: number; sourceHeight: number;
    renderWidth: number; renderHeight: number; regionCount: number;
  }): Record<string, number | string> {
    const timings: Record<string, number> = {};
    for (const [stage, milliseconds] of this.stages) timings[stage] = Math.round(milliseconds);
    for (const [name, value] of this.counters) timings[name] = Math.round(value);
    const line = { event: "COMIC_PAGE_TIMING", ...details, ...timings, TOTAL_PAGE: Math.round(now() - this.begun), memoryMb: memory() };
    console.info(JSON.stringify(line));
    return line;
  }
}

/** Heap in use, where the engine reports it. Chrome does on desktop and on Android. */
function memory(): number {
  const reading = (performance as { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize;
  return typeof reading === "number" ? Math.round(reading / (1 << 20)) : -1;
}
