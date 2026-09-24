import { createWorker, PSM, type Block, type Bbox, type ImageLike, type Line, type Worker } from "tesseract.js";
import type { ComicTextRegion, ComicTypography, NormalizedBounds } from "./ComicInteractionTypes";
import { comicContainerIsConvincing, type ComicStencil, type ComicVisualContainer } from "./ComicContainerDetector";
import { comicCropPlans, type ComicCropPlan } from "./ComicRegionCrop";
import type { ComicStageRecorder } from "./ComicStageTimer";

export interface ComicTextCandidate { bbox: Bbox; lines: Line[]; }

/** Asks the page for one region, prepared as the plan says. Supplied by the converter,
 *  which owns the canvas; the reading pipeline itself never touches pixels. */
export interface ComicCropRequest {
  bounds: Bbox;
  plan: ComicCropPlan;
  /** When present, everything outside this silhouette is painted out before reading, so a
   *  balloon is read on its own and not together with whatever it is drawn against. */
  stencil?: ComicStencil;
  /** The colour to paint it out with: the container's own, so nothing new appears. */
  background?: string;
}
export type ComicRegionCropper = (request: ComicCropRequest) => ImageLike | Promise<ImageLike>;

/** Keep segmentation boundaries: a nearby line in another paragraph is not evidence
 * that two balloons belong together. Split unusually large gaps within paragraphs. */
export function comicTextCandidates(blocks: readonly Block[]): ComicTextCandidate[] {
  const candidates: ComicTextCandidate[] = [];
  for (const block of blocks) for (const paragraph of block.paragraphs) {
    let group: ComicTextCandidate | undefined;
    for (const line of [...paragraph.lines].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)) {
      const b = line.bbox;
      if (b.x1 <= b.x0 || b.y1 <= b.y0) continue;
      const last = group?.lines.at(-1)?.bbox;
      const height = last ? Math.max(last.y1 - last.y0, b.y1 - b.y0) : 0;
      const overlap = group ? Math.min(group.bbox.x1, b.x1) - Math.max(group.bbox.x0, b.x0) : 0;
      if (!group || !last || b.y0 - last.y1 > height * 1.1 || overlap <= 0) {
        group = { bbox: { ...b }, lines: [line] }; candidates.push(group);
      } else {
        group.lines.push(line);
        group.bbox = { x0: Math.min(group.bbox.x0, b.x0), y0: Math.min(group.bbox.y0, b.y0), x1: Math.max(group.bbox.x1, b.x1), y1: Math.max(group.bbox.y1, b.y1) };
      }
    }
  }
  return candidates.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
}

/** Sparse OCR can return one paragraph per line. Join aligned lines, but never use
 * an accumulated block height as a distance threshold (which would bridge speakers). */
export function groupComicTextLines(candidates: readonly ComicTextCandidate[]): ComicTextCandidate[] {
  const lines = candidates.flatMap(candidate => candidate.lines).sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const groups: ComicTextCandidate[] = [];
  for (const line of lines) {
    const b = line.bbox, lineHeight = b.y1 - b.y0;
    const host = groups.find(group => {
      const last = group.lines.at(-1)!.bbox, gap = b.y0 - last.y1;
      const overlap = Math.min(last.x1, b.x1) - Math.max(last.x0, b.x0);
      const minWidth = Math.min(last.x1 - last.x0, b.x1 - b.x0);
      const centers = Math.abs((last.x0 + last.x1 - b.x0 - b.x1) / 2);
      return gap >= -lineHeight * .25 && gap <= Math.min(lineHeight, last.y1 - last.y0) * .85
        && overlap > minWidth * .4 && centers < Math.max(last.x1 - last.x0, b.x1 - b.x0) * .35;
    });
    if (!host) groups.push({ bbox: { ...b }, lines: [line] });
    else {
      host.lines.push(line); host.bbox = { x0: Math.min(host.bbox.x0, b.x0), y0: Math.min(host.bbox.y0, b.y0), x1: Math.max(host.bbox.x1, b.x1), y1: Math.max(host.bbox.y1, b.y1) };
    }
  }
  return groups;
}

export { comicContainerIsConvincing };

/** Whether a container is worth handing to recognition at all.
 *
 *  A page holds a couple of dozen flat shapes that enclose something, and only a handful
 *  of them are lettering. The others used to be read three times each before being thrown
 *  away on the strength of measurements that were already taken - on a phone that is most
 *  of the page's time. A container with no sign of glyphs in it is not read; one that is
 *  convincing always is, since that bar is far higher than this one. */
export function comicContainerIsWorthReading(container: ComicVisualContainer): boolean {
  return container.runs >= 8 && container.glyphShare >= .5 && container.inkShare >= .015;
}

/** Whether a reading looks like words at all.
 *
 *  Recognition never returns nothing: pointed at a flame or a face it returns specks of
 *  punctuation and stray letters. A region is only worth keeping for its text when that
 *  text has real words in it and is mostly letters rather than marks. This decides what to
 *  keep, never what to write: the text itself is untouched. */
export function comicTextLooksReadable(text: string): boolean {
  const trimmed = text.trim();
  if (letterCount(trimmed) < 3) return false;
  // One three-letter fragment is what recognition returns from a fold of cloth. Two of
  // them, or one real word, is what it returns from a line of lettering.
  const words = trimmed.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const solid = words.filter(word => word.length >= 3);
  if (solid.length < 2 && !solid.some(word => word.length >= 5)) return false;
  const marks = trimmed.replace(/\s/g, "").length;
  return marks > 0 && letterCount(trimmed) / marks >= .55;
}

interface Attempt { text: string; confidence: number; words: number[]; plan?: ComicCropPlan; }
interface Entry { container?: ComicVisualContainer; lines: Line[]; text?: Bbox; }

const letterCount = (text: string): number => text.replace(/[^\p{L}\p{N}]/gu, "").length;
const union = (boxes: readonly Bbox[]): Bbox | undefined => boxes.length === 0 ? undefined : boxes.reduce((a, b) => ({
  x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));

export class ComicRegionOcr {
  private worker?: Worker;
  public constructor(private readonly factory: () => Promise<Worker> = () => createWorker("por", 1, {
    workerPath: "/ocr/worker.min.js", corePath: "/ocr/core", langPath: "/ocr/lang",
    gzip: false, cacheMethod: "none", legacyCore: false, legacyLang: false,
  })) {}

  public async recognize(image: ImageLike, width: number, height: number, pageIndex: number, signal?: AbortSignal,
    containers: readonly ComicVisualContainer[] = [], crop?: ComicRegionCropper, timer?: ComicStageRecorder): Promise<ComicTextRegion[]> {
    signal?.throwIfAborted();
    let rejectAbort: (reason: unknown) => void = () => undefined;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const cancel = (): void => { rejectAbort(signal?.reason ?? new DOMException("Aborted", "AbortError")); void this.dispose(); };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      return await Promise.race([this.process(image, width, height, pageIndex, signal, containers, crop, timer), aborted]);
    } finally { signal?.removeEventListener("abort", cancel); }
  }

  /** Four passes over one page.
   *
   *  A reads the whole page loosely, so free lettering and text with no box around it is
   *  seen at all. B is the container detector, which knows nothing about letters and finds
   *  the boxes, balloons and captions whatever colour they are. D pairs the two up: each
   *  container takes the lines that fall inside it, and lines that fall in no container
   *  become free text. Every pairing is then read again on its own crop (C), enlarged and
   *  separated, which is where dark words on a yellow box finally become words. Containers
   *  that came out of D with nothing are read once more, with every preparation available,
   *  and the convincing ones survive marked for review rather than disappearing. */
  private async process(image: ImageLike, width: number, height: number, pageIndex: number, signal: AbortSignal | undefined,
    containers: readonly ComicVisualContainer[], crop?: ComicRegionCropper, timer?: ComicStageRecorder): Promise<ComicTextRegion[]> {
    if (!this.worker) {
      const worker = await this.factory();
      if (signal?.aborted) { await worker.terminate(); signal.throwIfAborted(); }
      this.worker = worker;
    }
    const worker = this.worker;
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: "300" });
    signal?.throwIfAborted();
    const layout = timer
      ? await timer.step("TEXT_DETECTION", () => worker.recognize(image, {}, { blocks: true, text: true }))
      : await worker.recognize(image, {}, { blocks: true, text: true });
    const seeds = comicTextCandidates(layout.data.blocks ?? []).filter(candidate => {
      const letters = letterCount(candidate.lines.map(line => line.text).join(""));
      return letters >= 4 || (letters >= 2 && candidate.lines.some(line => line.confidence >= 75));
    });

    const taken = new Set<ComicTextCandidate>();
    const entries: Entry[] = [];
    for (const container of containers) {
      if (!comicContainerIsWorthReading(container)) { timer?.count("ocrSkipped"); continue; }
      const inside = seeds.filter(seed => {
        const b = seed.bbox, centerX = (b.x0 + b.x1) / 2, centerY = (b.y0 + b.y1) / 2;
        return centerX >= container.bbox.x0 && centerX <= container.bbox.x1 && centerY >= container.bbox.y0 && centerY <= container.bbox.y1;
      });
      inside.forEach(seed => taken.add(seed));
      const groups = groupComicTextLines(inside);
      const area = (container.bbox.x1 - container.bbox.x0) * (container.bbox.y1 - container.bbox.y0) / (width * height);
      // A wide flat background can hold two speakers at once. A balloon, however large,
      // holds one - and splitting it would throw away its outline, which is exactly what
      // the enlarged balloon is made of. Only a fill bigger than any balloon is divided.
      if (groups.length <= 1 || area < .05) entries.push({ container, lines: groups[0]?.lines ?? [], text: groups[0]?.bbox });
      else for (const group of groups) entries.push({ container: { ...container, bbox: group.bbox, type: "other", shape: "unknown" }, lines: group.lines, text: group.bbox });
    }
    for (const group of groupComicTextLines(seeds.filter(seed => !taken.has(seed)))) entries.push({ lines: group.lines, text: group.bbox });

    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    const regions: ComicTextRegion[] = [];
    for (const entry of entries) {
      signal?.throwIfAborted();
      const region = await this.read(entry, { worker, image, crop, width, height, pageIndex, signal, order: regions.length + 1, timer });
      if (region) regions.push(region);
    }
    // Disjoint fills can still have overlapping rectangles. Keep the better recognized
    // target so a touch cannot be swallowed by a noisy duplicate of the same balloon.
    const selected: ComicTextRegion[] = [];
    for (const region of [...regions].sort((a, b) => (b.ocrConfidence ?? 0) - (a.ocrConfidence ?? 0))) {
      const duplicate = selected.some(other => {
        const intersection = Math.max(0, Math.min(region.x + region.width, other.x + other.width) - Math.max(region.x, other.x))
          * Math.max(0, Math.min(region.y + region.height, other.y + other.height) - Math.max(region.y, other.y));
        return intersection > Math.min(region.width * region.height, other.width * other.height) * .25;
      });
      if (!duplicate) selected.push(region);
    }
    return selected.sort((a, b) => a.y - b.y || a.x - b.x).map((region, index) => ({ ...region, id: `p${pageIndex + 1}-r${index + 1}` }));
  }

  /** One pairing, read on its own crop and turned into a region - or dropped. */
  private async read(entry: Entry, context: { worker: Worker; image: ImageLike; crop?: ComicRegionCropper; width: number; height: number; pageIndex: number; signal?: AbortSignal; order: number; timer?: ComicStageRecorder }):
  Promise<ComicTextRegion | null> {
    const { worker, image, crop, width, height, pageIndex, signal } = context;
    const lineBoxes = entry.lines.map(line => line.bbox);
    // Where the words are: everything the container holds as lettering, together with
    // whatever the page pass recognized. The loose pass often sees only the first line of
    // a balloon, and a box drawn around that one line would claim the balloon is written
    // in letters a third of their real size.
    const textBox = union([entry.container?.ink, entry.text ?? union(lineBoxes)].filter((box): box is Bbox => box !== undefined));
    const visualBox = entry.container ? entry.container.bbox : textBox ? pad(textBox, 4, width, height) : undefined;
    if (!visualBox || !textBox) return null;
    const readable = clampBox(entry.container ? pad(visualBox, -3, width, height) : pad(textBox, 3, width, height), width, height);
    if (readable.x1 <= readable.x0 || readable.y1 <= readable.y0) return null;

    const plans = comicCropPlans(readable.x1 - readable.x0, readable.y1 - readable.y0,
      entry.container?.darkOnLight ?? true, (entry.container?.typography.capHeight ?? 0) * height);
    const attempts: Attempt[] = [];
    const convincing = entry.container ? comicContainerIsConvincing(entry.container) : false;
    for (const [index, plan] of (crop ? plans : [undefined]).entries()) {
      signal?.throwIfAborted();
      const read = async (): Promise<Awaited<ReturnType<Worker["recognize"]>>> => plan && crop
        ? await worker.recognize(await crop({ bounds: readable, plan, stencil: stencilFor(entry.container, height), background: entry.container?.backgroundColor }), {}, { blocks: true, text: true })
        : await worker.recognize(image, { rectangle: { left: readable.x0, top: readable.y0, width: readable.x1 - readable.x0, height: readable.y1 - readable.y0 } }, { blocks: true, text: true });
      context.timer?.count("ocrCalls");
      context.timer?.count("ocrPixels", pixelsOf(readable, plan));
      const result = context.timer ? await context.timer.step("OCR", read) : await read();
      const lines = (result.data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines));
      attempts.push({ text: result.data.text.trim(), plan,
        confidence: Math.max(0, Math.min(1, (Number.isFinite(result.data.confidence) ? result.data.confidence : 0) / 100)),
        words: lines.flatMap(line => line.words.map(word => word.confidence)) });
      const last = attempts.at(-1)!;
      // Convincing enough: no reason to spend two more recognitions on this region.
      if (letterCount(last.text) >= 4 && last.confidence >= .8) break;
      // Words were read and read clearly enough to keep: that is what the other two
      // preparations were for, so they are not spent.
      if (comicTextLooksReadable(last.text) && last.confidence >= .6) break;
      // And nothing came of the first reading of something that was never convincing:
      // another two readings of the same nothing is how a page loses its minutes.
      if (index === 0 && !convincing && letterCount(last.text) < 3) break;
      // Free lettering has no container vouching for it. A third reading that has still
      // convinced nobody will not save it, and most of these are not lettering at all.
      if (index >= 1 && !entry.container) break;
    }
    // The best evidence wins, and nothing is merged between attempts: the text kept is one
    // reading of the image, never a sentence assembled from several guesses.
    const best = attempts.reduce((a, b) => score(b) > score(a) ? b : a, attempts[0] ?? { text: "", confidence: 0, words: [] });
    const initial = entry.lines.map(line => line.text.trim()).join("\n").trim();
    const text = letterCount(best.text) >= 2 ? best.text : letterCount(initial) >= 2 ? initial : best.text || initial;
    const confidence = best.text ? best.confidence : 0;
    // Two ways to earn a region: words were read, or the container is so clearly a box of
    // text that losing it would be worse than keeping it unread. Everything else - a face,
    // a flame, a fold of cloth that happened to enclose some marks - is dropped here.
    // Free lettering has no box vouching for it, so it has to be read clearly to count.
    const floor = entry.container ? .5 : .6, minimum = 4;
    const read = comicTextLooksReadable(text) && confidence >= floor && letterCount(text) >= minimum;
    if (!read && !convincing) return null;

    const reviewReasons: string[] = [];
    if (!best.text) reviewReasons.push("empty-region-pass");
    if (confidence < .85) reviewReasons.push("low-confidence");
    if (best.words.some(value => !Number.isFinite(value) || value < 60)) reviewReasons.push("uncertain-word");
    if (text.replace(/\s/g, "").length < 2) reviewReasons.push("short-text");
    if (!entry.container || entry.container.shape === "unknown") reviewReasons.push("unverified-boundary");
    if (best.plan && best.plan.mode !== "photo") reviewReasons.push(`prepared-${best.plan.mode}`);

    const hitBox = pad(visualBox, Math.max(6, Math.min(visualBox.x1 - visualBox.x0, visualBox.y1 - visualBox.y0) * .04), width, height);
    const normalize = (box: Bbox): NormalizedBounds => ({ x: box.x0 / width, y: box.y0 / height, width: (box.x1 - box.x0) / width, height: (box.y1 - box.y0) / height });
    const hit = normalize(hitBox);
    return {
      id: `p${pageIndex + 1}-r${context.order}`, pageIndex, text,
      ...hit, hitBounds: hit, visualBounds: normalize(visualBox), textBounds: normalize(clampBox(textBox, width, height)),
      type: entry.container?.type ?? "free-text", shape: entry.container?.shape ?? "unknown",
      tailDirection: entry.container?.tail ?? "none", tail: entry.container?.tail ?? "none",
      ocrConfidence: confidence, recognitionStatus: reviewReasons.length ? "needs-review" : "recognized", reviewReasons,
      backgroundColor: entry.container?.backgroundColor, textColor: entry.container?.textColor, borderColor: entry.container?.borderColor,
      // The outline travels normalized to the page, like every other rectangle here, so a
      // balloon can be drawn again at any size without the drawing around it.
      contour: entry.container?.contour?.map(point => ({ x: point.x / width, y: point.y / height })),
      typography: typographyOf(entry, lineBoxes, height), styleConfidence: entry.container?.styleConfidence,
    };
  }

  public async dispose(): Promise<void> { const worker = this.worker; this.worker = undefined; await worker?.terminate(); }
}

/** The stencil to read a container through, when reading it through one helps.
 *
 *  Painting out everything around a balloon is what lets two balloons drawn together be
 *  read separately, and it keeps the artwork from lending a balloon half a letter. Display
 *  lettering is the exception: a shout is drawn across its own outline, so a stencil cut on
 *  that line would shave the tops off the letters, and such a container is read whole. */
function stencilFor(container: ComicVisualContainer | undefined, pageHeight: number): ComicStencil | undefined {
  if (!container) return undefined;
  const height = container.bbox.y1 - container.bbox.y0;
  const cap = ((container.typography?.capHeight ?? 0) * pageHeight) / Math.max(1, height);
  return cap > .3 ? undefined : container.stencil;
}

/** The lettering as measured, preferring the recognized lines themselves.
 *
 *  The detector measures bands of ink, which a drawing inside the same box - the little
 *  hand in the corner of a caption - stretches into one tall band. Where recognition found
 *  real lines, their own heights are the better evidence of how big the letters are. */
function typographyOf(entry: Entry, lines: readonly Bbox[], pageHeight: number): ComicTypography | undefined {
  const base = entry.container?.typography;
  if (lines.length === 0) return base;
  const heights = lines.map(line => line.y1 - line.y0).sort((a, b) => a - b);
  const capHeight = heights[Math.floor(heights.length / 2)]! / pageHeight;
  if (!Number.isFinite(capHeight) || capHeight <= 0) return base;
  return { family: base?.family ?? "comic", weight: base?.weight ?? "normal", italic: base?.italic ?? false,
    align: base?.align ?? "center", capHeight, lines: lines.length };
}

/** How many pixels a reading attempt actually hands to recognition. */
function pixelsOf(bounds: Bbox, plan?: ComicCropPlan): number {
  const width = Math.max(1, bounds.x1 - bounds.x0), height = Math.max(1, bounds.y1 - bounds.y0);
  const scale = plan?.scale ?? 1, margin = (plan?.margin ?? 0) * 2;
  return Math.round((width * scale + margin) * (height * scale + margin));
}

/** Longer text and firmer recognition win; an empty reading never does. */
function score(attempt: Attempt): number {
  const letters = letterCount(attempt.text);
  if (letters === 0) return -1;
  return attempt.confidence * Math.min(1, letters / 8) + Math.min(.2, letters / 200);
}

function pad(box: Bbox, amount: number, width: number, height: number): Bbox {
  return clampBox({ x0: box.x0 - amount, y0: box.y0 - amount, x1: box.x1 + amount, y1: box.y1 + amount }, width, height);
}

function clampBox(box: Bbox, width: number, height: number): Bbox {
  return { x0: Math.max(0, Math.floor(box.x0)), y0: Math.max(0, Math.floor(box.y0)),
    x1: Math.min(width, Math.ceil(box.x1)), y1: Math.min(height, Math.ceil(box.y1)) };
}
