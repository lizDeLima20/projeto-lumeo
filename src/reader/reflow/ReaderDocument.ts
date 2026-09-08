export interface ReaderParagraph { id: string; text: string; sourcePage: number; kind: "heading" | "paragraph"; sourceBlockId?:string; sourceStart?:number; }
export interface ReaderCoverPage { title: string; author?: string; image?: string; }
export interface ReaderPage { index: number; paragraphs: ReaderParagraph[]; startOffset: number; endOffset: number; cover?: ReaderCoverPage; }
export interface ReadingAnchor { paragraphId: string; textOffset: number; logicalOffset: number; }
export class ReaderDocument { public constructor(public readonly paragraphs: ReaderParagraph[], public readonly totalCharacters: number) {} }
