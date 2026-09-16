import type { ReadingReview } from "../models/ReadingReview";
import { IndexedDbService, STORE_NAMES } from "../services/IndexedDbService";

export class ReadingReviewRepository {
  public constructor(private readonly database: IndexedDbService) {}

  public async get(userId: string, bookId: string): Promise<ReadingReview | null> {
    const key = ReadingReviewRepository.key(userId, bookId);
    return (await this.database.request<ReadingReview | undefined>(STORE_NAMES.readingReviews, "readonly", store => store.get(key))) ?? null;
  }

  public async save(review: Omit<ReadingReview, "id" | "createdAt" | "updatedAt">): Promise<ReadingReview> {
    const now = new Date().toISOString(), existing = await this.get(review.userId, review.bookId);
    const value: ReadingReview = {
      ...review,
      id: ReadingReviewRepository.key(review.userId, review.bookId),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.database.request(STORE_NAMES.readingReviews, "readwrite", store => store.put(value));
    return value;
  }

  public async deleteByBook(bookId: string): Promise<void> {
    const all = await this.database.getAll<ReadingReview>(STORE_NAMES.readingReviews);
    await Promise.all(all.filter(value => value.bookId === bookId).map(value =>
      this.database.request(STORE_NAMES.readingReviews, "readwrite", store => store.delete(value.id))));
  }

  private static key(userId: string, bookId: string): string { return `${userId}:${bookId}`; }
}
