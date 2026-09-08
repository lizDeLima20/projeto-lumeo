import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { IndexedDbService } from "../src/services/IndexedDbService";
import { ChapterStudySheetRepository } from "../src/repositories/ChapterStudySheetRepository";
import { ChapterStudySheetService } from "../src/reader/study/ChapterStudySheetService";
import { ChapterStudyController } from "../src/reader/study/ChapterStudyController";
import { StudyExportModel } from "../src/reader/study/StudyExportModel";
import { StudyNotebook } from "../src/reader/study/StudyNotebook";
import { LimaDocumentFactory } from "../src/lima/LimaDocumentFactory";

Object.assign(globalThis, { indexedDB, IDBKeyRange, window: globalThis });
function setup() { const repository = new ChapterStudySheetRepository(new IndexedDbService(`sheets-${crypto.randomUUID()}`)); return { repository, service: new ChapterStudySheetService(repository) }; }

describe("Fichário de capítulo", () => {
  it("createSheet e loadByChapter", async () => { const { repository, service } = setup(); const sheet = service.createSheet("u", "b", "c"); await repository.save(sheet); assert.equal((await repository.loadByChapter("u", "b", "c"))?.id, sheet.id); });
  it("updateSummary", () => { const { service } = setup(); assert.equal(service.updateSummary(service.createSheet("u", "b", "c"), "Resumo").summary, "Resumo"); });
  it("addTopic editTopic deleteTopic reorderTopics", () => { const { service } = setup(); let sheet = service.createSheet("u", "b", "c"); sheet = service.addTopic(sheet, "A"); sheet = service.addTopic(sheet, "B"); sheet = service.reorderTopics(sheet, sheet.topics[1]!.id, -1); assert.equal(sheet.topics[0]!.text, "B"); sheet = service.editTopic(sheet, sheet.topics[0]!.id, "C"); assert.equal(sheet.topics[0]!.text, "C"); sheet = service.deleteTopic(sheet, sheet.topics[0]!.id); assert.equal(sheet.topics.length, 1); });
  it("addQuestion editQuestion deleteQuestion", () => { const { service } = setup(); let sheet = service.addQuestion(service.createSheet("u", "b", "c"), "Q", "A"); sheet = service.editQuestion(sheet, sheet.questions[0]!.id, "Q2", "A2"); assert.equal(sheet.questions[0]!.answer?.text, "A2"); sheet = service.deleteQuestion(sheet, sheet.questions[0]!.id); assert.equal(sheet.questions.length, 0); });
  it("addDoubt resolveDoubt", () => { const { service } = setup(); let sheet = service.addDoubt(service.createSheet("u", "b", "c"), "D"); sheet = service.resolveDoubt(sheet, sheet.doubts[0]!.id); assert.equal(sheet.doubts[0]!.resolved, true); });
  it("linkAnchor e searchSheet", () => { const { service } = setup(); let sheet = service.addTopic(service.createSheet("u", "b", "c"), "Educação"); sheet = service.linkAnchor(sheet, "topic", sheet.topics[0]!.id, { blockId: "p-1", offset: 2 }); assert.equal(sheet.topics[0]!.sourceAnchor?.blockId, "p-1"); assert.equal(service.searchSheet(sheet, "educacao").topics.length, 1); });
  it("autosaveDebounce", async () => { const { repository, service } = setup(); const controller = new ChapterStudyController(service, "u", "b", 10); await controller.loadByChapter("c"); controller.updateSummary("Persistido"); await new Promise(resolve => setTimeout(resolve, 30)); assert.equal((await repository.loadByChapter("u", "b", "c"))?.summary, "Persistido"); });
  it("exportIncludesSheets", () => { const { service } = setup(), sheet = service.createSheet("u", "b", "c"), document = new LimaDocumentFactory().create({ file: new File([""], "book.pdf"), id: "b", title: "Livro", author: "Autor" }, "pdf", [], []), notebook = new StudyNotebook("b", "Livro", []); assert.equal(new StudyExportModel().build(document, notebook, [sheet]).chapterStudySheets.length, 1); });
});
