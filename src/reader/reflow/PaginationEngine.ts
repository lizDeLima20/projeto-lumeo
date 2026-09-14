import type { ReaderDocument, ReaderPage, ReadingAnchor } from "./ReaderDocument";
type BlockKind = "heading" | "paragraph";
/** Width of a run of text in the reading font, in px. */
export type TextMeasure = (text: string, kind: BlockKind) => number;
/** Vertical rhythm read off a rendered page, in px. */
export interface PageRhythm { lineHeight: number; paragraphGap: number; headingLineHeight: number; headingMarginTop: number; headingMarginBottom: number; }
export interface PaginationMetrics {
  width: number; height: number; fontSize: number; lineHeight: number; margin: number;
  /** The text box of a real, rendered page. When present it replaces width/height/margin
   *  outright - no 760px cap, no guessed margins - so pages fill exactly the space the
   *  stylesheet gives them. */
  content?: { width: number; height: number };
  rhythm?: PageRhythm;
  /** When present, lines are broken by measuring words in the real font instead of by an
   *  average character width. */
  measure?: TextMeasure;
}

interface Layout { width: number; lineHeight: number; headingLineHeight: number; paragraphGap: number; headingGap: number; measure: TextMeasure; splitLongWords: boolean; }

export class PaginationEngine {
  /** Measured lines are filled to this share of the box. Canvas and DOM disagree by
   *  fractions of a pixel, and the last word of a line is the one that pays for it. */
  public static readonly measuredFill = .995;

  public paginate(document: ReaderDocument, metrics: PaginationMetrics): ReaderPage[] {
    const layout = this.layout(metrics);
    const usableHeight = metrics.content ? metrics.content.height : Math.max(240, metrics.height - 2 * metrics.margin), pages: ReaderPage[] = [];
    let current: ReaderPage = { index: 0, paragraphs: [], startOffset: 0, endOffset: 0 }, offset = 0, used = 0;
    const push = () => { current.endOffset = offset; if (current.paragraphs.length || !pages.length) pages.push(current); current = { index: pages.length, paragraphs: [], startOffset: offset, endOffset: offset }; used = 0; };
    for (let paragraphIndex = 0; paragraphIndex < document.paragraphs.length; paragraphIndex++) {
      const paragraph = document.paragraphs[paragraphIndex]!, next = document.paragraphs[paragraphIndex + 1], height = this.blockHeight(paragraph.text, paragraph.kind, layout);
      /* A visual leaf may divide a physical PDF page, but it never blends two physical
         source pages. This gives every generated leaf a stable 1A / 1B identity. */
      const currentSourcePage = current.paragraphs[0]?.sourcePage;
      if (current.paragraphs.length && currentSourcePage !== paragraph.sourcePage) push();
      if (paragraph.kind === "heading" && next && current.paragraphs.length) { const pairHeight = height + Math.min(this.blockHeight(next.text, next.kind, layout), this.linesHeight(PaginationEngine.minLines, next.kind, layout)); if (used + pairHeight > usableHeight && pairHeight <= usableHeight) push(); }
      if (used + height <= usableHeight) { current.paragraphs.push({ ...paragraph, sourceBlockId: paragraph.sourceBlockId ?? paragraph.id, sourceStart: paragraph.sourceStart ?? 0 }); used += height; offset += paragraph.text.length; continue; }
      /* It does not fit in what is left. A paragraph flows on into the next page, as it
         would in a printed book, instead of leaving the rest of this one blank. Headings
         keep whole and move on. */
      if (paragraph.kind === "heading" && current.paragraphs.length && height <= usableHeight) { push(); current.paragraphs.push({ ...paragraph, sourceBlockId: paragraph.sourceBlockId ?? paragraph.id, sourceStart: paragraph.sourceStart ?? 0 }); used += height; offset += paragraph.text.length; continue; }
      let remaining = paragraph.text, sourceStart = 0;
      while (remaining.trim()) {
        const piece$ = { ...paragraph, sourceBlockId: paragraph.sourceBlockId ?? paragraph.id, sourceStart: (paragraph.sourceStart ?? 0) + sourceStart };
        const id = sourceStart ? `${paragraph.id}-${sourceStart}` : paragraph.id;
        if (used + this.blockHeight(remaining, paragraph.kind, layout) <= usableHeight) { current.paragraphs.push({ ...piece$, id, text: remaining }); used += this.blockHeight(remaining, paragraph.kind, layout); offset += remaining.length; break; }
        let text = this.balance(this.fitTextByWords(remaining, paragraph.kind, layout, usableHeight - used), remaining, paragraph.kind, layout);
        if (!text) {
          if (current.paragraphs.length) { push(); continue; }
          text = this.fitTextByWords(remaining, paragraph.kind, layout, usableHeight) || this.firstWord(remaining);
        }
        current.paragraphs.push({ ...piece$, id, text });
        used += this.blockHeight(text, paragraph.kind, layout); offset += text.length; sourceStart += text.length; remaining = remaining.slice(text.length).trimStart();
        if (remaining) push();
      }
    }
    current.endOffset = offset; if (current.paragraphs.length || !pages.length) pages.push(current);
    return this.labelSourceParts(pages);
  }
  /** A split never leaves a single line stranded: at least this many lines stay at the foot
   *  of the page (no orphan) and at least this many carry over to the next (no widow). */
  public static readonly minLines = 2;
  /** Trims a split so both halves keep `minLines`; empty when that is impossible here, and
   *  the whole paragraph should start on the next page instead. */
  private balance(piece: string, whole: string, kind: BlockKind, layout: Layout): string {
    if (!piece) return "";
    const words = piece.split(/\s+/).filter(Boolean);
    let count = words.length;
    while (count > 0) {
      const head = words.slice(0, count).join(" "), rest = whole.slice(this.prefixLength(whole, count)).trimStart();
      if (this.lineCount(head, kind, layout) < PaginationEngine.minLines) return "";
      if (!rest || this.lineCount(rest, kind, layout) >= PaginationEngine.minLines) return head;
      count--;
    }
    return "";
  }
  /** Length of `text` up to the end of its `count`-th word, keeping the original spacing so
   *  source offsets stay exact. */
  private prefixLength(text: string, count: number): number {
    const match = new RegExp(`^\\s*(?:\\S+\\s+){${Math.max(0, count - 1)}}\\S+`).exec(text);
    return match ? match[0].length : text.length;
  }
  private linesHeight(lines: number, kind: BlockKind, layout: Layout): number {
    return kind === "heading" ? lines * layout.headingLineHeight + layout.headingGap : lines * layout.lineHeight + layout.paragraphGap;
  }
  public withCover(pages: ReaderPage[], cover: { title: string; author?: string; image?: string }): ReaderPage[] { return [{ index: 0, paragraphs: [], startOffset: 0, endOffset: 0, cover, visualLabel: "Capa" }, ...pages.map((page, index) => ({ ...page, index: index + 1 }))]; }
  public pageForAnchor(pages: readonly ReaderPage[], anchor: ReadingAnchor): number { const found = pages.findIndex(page => !page.cover && anchor.logicalOffset >= page.startOffset && anchor.logicalOffset <= page.endOffset); return Math.max(0, found); }

  /** Measured when the reader could measure; otherwise the average-character estimate the
   *  engine always used, kept exactly so pagination outside a browser is unchanged. */
  private layout(metrics: PaginationMetrics): Layout {
    const lineHeight = Math.max(16, metrics.fontSize * metrics.lineHeight), gap = Math.max(6, metrics.fontSize * .75);
    if (metrics.content && metrics.rhythm && metrics.measure) {
      const cache = { heading: new Map<string, number>(), paragraph: new Map<string, number>() }, measure = metrics.measure;
      return {
        width: metrics.content.width * PaginationEngine.measuredFill,
        lineHeight: metrics.rhythm.lineHeight, headingLineHeight: metrics.rhythm.headingLineHeight,
        paragraphGap: metrics.rhythm.paragraphGap, headingGap: metrics.rhythm.headingMarginTop + metrics.rhythm.headingMarginBottom,
        measure: (text, kind) => { const words = cache[kind]; let width = words.get(text); if (width === undefined) { width = measure(text, kind); words.set(text, width); } return width; },
        splitLongWords: true,
      };
    }
    return {
      width: metrics.content ? metrics.content.width : Math.max(180, Math.min(metrics.width - 2 * metrics.margin, 760)),
      lineHeight, headingLineHeight: lineHeight * 1.18, paragraphGap: gap, headingGap: gap * 1.2,
      measure: (text, kind) => text.length * metrics.fontSize * (kind === "heading" ? .62 : .52),
      splitLongWords: false,
    };
  }
  private blockHeight(text: string, kind: BlockKind, layout: Layout): number {
    const lines = this.lineCount(text, kind, layout);
    return kind === "heading" ? lines * layout.headingLineHeight + layout.headingGap : lines * layout.lineHeight + layout.paragraphGap;
  }
  /** Greedy line filling, the way the browser breaks `white-space: normal`. With
   *  `overflow-wrap: break-word` a word wider than the whole line is split across lines
   *  rather than left sticking out of the side of the page. */
  private lineCount(text: string, kind: BlockKind, layout: Layout): number {
    const space = layout.measure(" ", kind); let lines = 1, line = 0;
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const width = layout.measure(word, kind), next = line > 0 ? line + space + width : width;
      if (next <= layout.width || (line === 0 && !layout.splitLongWords)) { line = next; continue; }
      if (line > 0) lines++;
      if (width <= layout.width || !layout.splitLongWords) { line = width; continue; }
      const rows = Math.ceil(width / layout.width);
      lines += rows - 1; line = width - (rows - 1) * layout.width;
    }
    return lines;
  }
  /** Longest run of whole words that fits in `available`. Block height only grows as
   *  words are added, so a binary search over the word count finds it in O(n log n)
   *  measurements instead of re-measuring every prefix. */
  private fitTextByWords(text: string, kind: BlockKind, layout: Layout, available: number): string {
    const words = text.split(/\s+/).filter(Boolean); let low = 0, high = words.length;
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (this.blockHeight(words.slice(0, middle).join(" "), kind, layout) <= available) low = middle; else high = middle - 1; }
    return words.slice(0, low).join(" ");
  }
  private firstWord(text: string): string { return text.match(/\S+/)?.[0] ?? ""; }
  private labelSourceParts(pages: ReaderPage[]): ReaderPage[] {
    const groups = new Map<number, ReaderPage[]>();
    for (const page of pages) {
      const sourcePage = page.paragraphs[0]?.sourcePage;
      if (sourcePage === undefined) continue;
      const group = groups.get(sourcePage) ?? [];
      group.push(page); groups.set(sourcePage, group);
    }
    for (const [sourcePage, group] of groups) {
      group.forEach((page, index) => Object.assign(page, {
        sourcePage,
        sourcePart: index + 1,
        sourcePartCount: group.length,
        visualLabel: `${sourcePage}${this.partLabel(index)}`,
      }));
    }
    return pages;
  }
  private partLabel(index: number): string {
    let value = index + 1, label = "";
    while (value > 0) { value--; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26); }
    return label;
  }
}
