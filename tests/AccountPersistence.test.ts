import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Book } from "../src/models/Book";
import { AccountPersistenceService } from "../src/services/AccountPersistenceService";
import type { ApiClient } from "../src/services/ApiClient";

describe("AccountPersistenceService", () => {
  it("sendsOnlyVersionedMetadataAndReviewForCrossDeviceSync", async () => {
    let request: unknown;
    const api = { post: async (_path: string, body: unknown) => {
      request = body;
      const input = body as { book: { bookId: string; metadata: Record<string, unknown>; updatedAt: string } };
      return { book: { bookId: input.book.bookId, metadata: input.book.metadata, updatedAt: input.book.updatedAt } };
    } } as unknown as ApiClient;
    const book = new Book({ id:"local-id", catalogBookId:"catalog-stable-id", title:"Livro", author:"Autora", genreId:"study", cover:"data:image/png;base64,private-cover", fileType:"pdf", fileName:"livro.pdf", fileSize:12, mimeType:"application/pdf", readingStatus:"reading", progressPercent:37, currentLocation:"logical:123", source:"catalog", updatedAt:new Date("2026-09-16T10:00:00.000Z") });
    await new AccountPersistenceService(api).saveBook(book, { id:"study", name:"Estudos" }, { id:"u:local-id", userId:"u", bookId:"local-id", rating:5, comment:"Ótimo", createdAt:"2026-09-16T10:01:00.000Z", updatedAt:"2026-09-16T10:01:00.000Z" });
    const payload = request as { book: { updatedAt: string; metadata: Record<string, unknown> } };
    assert.equal(payload.book.updatedAt, "2026-09-16T10:01:00.000Z");
    assert.equal(payload.book.metadata.catalogBookId, "catalog-stable-id");
    assert.equal(payload.book.metadata.progressPercent, 37);
    assert.equal((payload.book.metadata.review as { rating: number }).rating, 5);
    assert.equal(payload.book.metadata.cover, null);
    assert.doesNotMatch(JSON.stringify(payload), /private-cover/);
  });
});
