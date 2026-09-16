/** A local, user-scoped response after the reader reaches a book's real end. */
export interface ReadingReview {
  readonly id: string;
  readonly userId: string;
  readonly bookId: string;
  readonly rating: 1 | 2 | 3 | 4 | 5;
  readonly comment?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
