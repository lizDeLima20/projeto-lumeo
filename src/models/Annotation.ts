export interface AnnotationData {
  id: string; userId?: string; bookId: string; highlightId: string; text: string;
  /** Significado/Tradução looked up for this same trecho, kept alongside the note so the
   *  ficha de estudo ("Mais") and "Abrir marcações" can show everything about one highlight
   *  in one place - never invented, only ever what the reader actually looked up and kept. */
  definitionText?: string; translationText?: string;
  createdAt: string; updatedAt: string;
}
export class Annotation implements AnnotationData {
  public readonly id: string; public readonly userId?: string; public readonly bookId: string; public readonly highlightId: string; public readonly text: string;
  public readonly definitionText?: string; public readonly translationText?: string;
  public readonly createdAt: string; public readonly updatedAt: string;
  public constructor(data: AnnotationData) {
    Object.assign(this, data);
    this.id = data.id; this.userId = data.userId; this.bookId = data.bookId; this.highlightId = data.highlightId; this.text = data.text;
    this.definitionText = data.definitionText; this.translationText = data.translationText;
    this.createdAt = data.createdAt; this.updatedAt = data.updatedAt;
  }
}
