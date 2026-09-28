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
  /** How far through a long stage this page is, from 0 to 1. Recognition reads one region
   *  at a time and takes most of the page's minute, so it says where it is as it goes. */
  note(stage: ComicStage, share: number): void;
}

/** What each stage is worth of a page, measured on the phone: the shares add up to one,
 *  so the reader is told about real work rather than watched by a timer counting to a
 *  hundred on its own. */
const STAGE_SHARE: Record<ComicStage, number> = {
  PDF_RENDER: .18, ASSET_ENCODING: .05, BITMAP_CREATE: .04, CONTAINER_DETECTION: .13,
  TEXT_DETECTION: .07, REGION_CROP: .06, OCR: .38, MASK_GENERATION: .06, INDEXEDDB_WRITE: .03,
};

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
  private readonly shares = new Map<ComicStage, number>();
  private readonly begun = now();
  private announced = 0;

  /** `onProgress` receives this page's own progress, from 0 to 1, and never goes back. */
  public constructor(private readonly onProgress?: (share: number) => void) {}

  public async step<T>(stage: ComicStage, work: () => T | Promise<T>): Promise<T> {
    const started = now();
    try { return await work(); }
    finally { this.add(stage, now() - started); this.note(stage, 1); }
  }

  public note(stage: ComicStage, share: number): void {
    const reached = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 1;
    if (reached <= (this.shares.get(stage) ?? 0)) return;
    this.shares.set(stage, reached);
    let total = 0;
    for (const [name, value] of this.shares) total += STAGE_SHARE[name] * value;
    // Monotonic by construction: a page that reached sixty-five per cent never says forty.
    if (total <= this.announced) return;
    this.announced = total;
    this.onProgress?.(total);
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
