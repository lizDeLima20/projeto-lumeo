import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { BookMetadataExtractor } from "../src/metadata/BookMetadataExtractor";
import { TitleDetector } from "../src/metadata/TitleDetector";
import { AuthorDetector } from "../src/metadata/AuthorDetector";
import { GenreClassifier } from "../src/metadata/GenreClassifier";
import { GenreSuggestionResolver } from "../src/metadata/GenreSuggestionResolver";
import type { MetadataSourceExtractor, NativeBookMetadata } from "../src/metadata/MetadataTypes";
import { Genre } from "../src/models/Genre";
import { Collection } from "../src/models/Collection";
import { CollectionRepository } from "../src/repositories/CollectionRepository";
import { IndexedDbService } from "../src/services/IndexedDbService";
Object.assign(globalThis, { indexedDB, IDBKeyRange });
const source = (metadata: NativeBookMetadata): MetadataSourceExtractor => ({ extract: async () => metadata });

describe("detectores de metadados", () => {
  it("metadataTitleDetected", () => assert.deepEqual(new TitleDetector().detect({ title: "Quem Pensa Enriquece" }, "arquivo.pdf"), { value: "Quem Pensa Enriquece", confidence: "high" }));
  it("metadataAuthorDetected", () => assert.deepEqual(new AuthorDetector().detect({ author: "Napoleon Hill" }, "Quem Pensa Enriquece"), { value: "Napoleon Hill", confidence: "high" }));
  it("titleFromFirstPage", () => assert.deepEqual(new TitleDetector().detect({ firstPageText: "QUEM PENSA ENRIQUECE\npor Napoleon Hill" }, "arquivo.pdf"), { value: "Quem Pensa Enriquece", confidence: "medium" }));
  it("authorFromFirstPage", () => assert.deepEqual(new AuthorDetector().detect({ firstPageText: "QUEM PENSA ENRIQUECE\npor Napoleon Hill" }, "Quem Pensa Enriquece"), { value: "Napoleon Hill", confidence: "medium" }));
  it("fallbackToFilename", () => assert.deepEqual(new TitleDetector().detect({}, "quem_pensa-enriquece.pdf"), { value: "quem pensa enriquece", confidence: "low" }));
  it("knownAuthorGenreSuggestion", () => assert.deepEqual(new GenreClassifier().classify({}, "Quem Pensa Enriquece", "Napoleon Hill"), { value: "Desenvolvimento Pessoal", confidence: "high" }));
});

describe("BookMetadataExtractor e sugestões", () => {
  it("authorCollectionSuggested", async () => { const result = await new BookMetadataExtractor().extract(new File(["x"], "livro.pdf"), "pdf", source({ title: "Quem Pensa Enriquece", author: "Napoleon Hill" })); assert.equal(result.collection?.value, "Napoleon Hill"); assert.equal(result.collection?.confidence, "high"); });
  it("lowConfidenceDoesNotAutocreate", async () => { const result = await new BookMetadataExtractor().extract(new File(["x"], "livro.pdf"), "pdf", source({ firstPageText: "Título\npor Nome Incerto" })); assert.equal(result.author?.confidence, "medium"); assert.equal(result.collection, undefined); });
  it("existingGenreSelected", () => { const genre = new Genre("dev", "Desenvolvimento Pessoal"); const result = new GenreSuggestionResolver().resolve({ value: "Desenvolvimento Pessoal", confidence: "high" }, [genre]); assert.equal(result.kind, "existing"); });
  it("newGenreSuggested", () => assert.deepEqual(new GenreSuggestionResolver().resolve({ value: "Finanças", confidence: "medium" }, []), { kind: "new", name: "Finanças" }));
});

describe("CollectionRepository", () => {
  it("persiste e encontra coleção por autor", async () => { const repository = new CollectionRepository(new IndexedDbService(`collections-${crypto.randomUUID()}`)); const collection = new Collection("napoleon", "Napoleon Hill", "author"); await repository.save(collection); assert.equal((await repository.findByName("napoleon hill"))?.id, "napoleon"); });
});
