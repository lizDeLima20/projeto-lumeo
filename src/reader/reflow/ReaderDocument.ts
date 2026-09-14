export interface ReaderParagraph { id: string; text: string; sourcePage: number; kind: "heading" | "paragraph"; sourceBlockId?:string; sourceStart?:number; }
export interface ReaderCoverPage { title: string; author?: string; image?: string; }
/** A rendered leaf. `sourcePage` is the immutable page from the source document;
 * `sourcePart` is the responsive subdivision that the reader creates for it. */
export interface ReaderPage {
  index: number;
  paragraphs: ReaderParagraph[];
  startOffset: number;
  endOffset: number;
  cover?: ReaderCoverPage;
  sourcePage?: number;
  sourcePart?: number;
  sourcePartCount?: number;
  visualLabel?: string;
}
export interface ReadingAnchor { paragraphId: string; textOffset: number; logicalOffset: number; }
export class ReaderDocument { public constructor(public readonly paragraphs: ReaderParagraph[], public readonly totalCharacters: number) {} }
