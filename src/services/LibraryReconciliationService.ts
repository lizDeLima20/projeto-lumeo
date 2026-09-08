import type { Book } from "../models/Book";
import type { LimaDocument } from "../lima/LimaDocument";
import { LimaValidator } from "../lima/LimaValidator";
export type LibraryRecordState = "VALID" | "MISSING_FILE" | "ORPHAN_FILE" | "INVALID_LIMA" | "DUPLICATE";
export interface LibraryReconciliation { state: LibraryRecordState; bookId: string; book?: Book; document?: LimaDocument; }
export class LibraryReconciliationService {
  public inspect(book: Book | null, hasOriginal: boolean, document: LimaDocument | null): LibraryReconciliation { if (!book && document) return this.valid(document) ? { state: "ORPHAN_FILE", bookId: document.metadata.id, document } : { state: "INVALID_LIMA", bookId: document.metadata.id, document }; if (!book) return { state: "MISSING_FILE", bookId: "unknown" }; if (!hasOriginal && !document) return { state: "MISSING_FILE", bookId: book.id, book }; if (document && !this.valid(document)) return { state: "INVALID_LIMA", bookId: book.id, book, document }; return { state: "VALID", bookId: book.id, book, document: document ?? undefined }; }
  public deduplicate(documents: readonly LimaDocument[]): LimaDocument[] { return [...new Map(documents.map(document => [document.manifest.documentId, document])).values()]; }
  private valid(document: LimaDocument): boolean { try { new LimaValidator().validate(document); return true; } catch { return false; } }
}
