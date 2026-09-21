import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DriveEntryClassifier } from "../src/collections/DriveEntryClassifier.js";
import { DriveRequestLimiter } from "../src/collections/DriveRequestLimiter.js";
import { DriveFolderBrowser } from "../src/collections/DriveFolderBrowser.js";
import { DriveCollectionService } from "../src/collections/DriveCollectionService.js";
import { collectionLibraryReference, CollectionLibraryReferenceError } from "../src/collections/CollectionLibraryReference.js";
import type { DriveCollection } from "../src/collections/types.js";

const ROOT = "1wXs64lZ0nOBAAWwGutDHfjO-TnfYO6Ee";
const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
const collection: DriveCollection = { id: "marvel-hqs", name: "HQs da Marvel", rootFolderId: ROOT, contentType: "comic" };

/** The shapes the real collection was reported to contain. */
const files = [
  { id: "f-pdf", name: "Capítulo 01.pdf", mimeType: "application/pdf" },
  { id: "f-sem-ext", name: "Capítulo 02", mimeType: "application/pdf" },
  { id: "f-cbr", name: "Guerras Secretas 01.cbr", mimeType: "application/x-cbr" },
  { id: "f-cbr-generico", name: "Guerras Secretas 02.cbr", mimeType: "application/octet-stream" },
  { id: "f-rar", name: "Anual", mimeType: "application/x-rar-compressed" },
  { id: "f-estranha", name: "Capítulo 03.pdf.txt", mimeType: "application/pdf" },
  { id: "f-desconhecido", name: "notas", mimeType: "application/octet-stream" },
  { id: "f-epub", name: "Guia.epub", mimeType: "application/epub+zip" },
];

function drive(nodes: { id: string; name: string; mimeType: string; parent: string | null; shortcutDetails?: unknown }[]) {
  const request = async (url: URL): Promise<Response> => {
    const query = url.searchParams.get("q");
    if (query) {
      const parent = /'([^']+)' in parents/.exec(query)![1]!;
      return new Response(JSON.stringify({ files: nodes.filter(n => n.parent === parent) }), { status: 200 });
    }
    const id = decodeURIComponent(url.pathname.split("/").pop()!);
    const node = nodes.find(n => n.id === id);
    if (!node) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ id: node.id, name: node.name, mimeType: node.mimeType, parents: node.parent ? [node.parent] : [] }), { status: 200 });
  };
  return request;
}

describe("tipos de arquivo vêm da metadata do Drive", () => {
  const classifier = new DriveEntryClassifier();
  it("6. arquivo sem extensão é reconhecido pelo mimeType", () => {
    assert.equal(classifier.format("application/pdf", "Capítulo 02"), "pdf");
    assert.equal(classifier.isSupported("pdf"), true);
  });
  it("5. CBR nunca vira PDF", () => {
    assert.equal(classifier.format("application/x-cbr", "Guerras Secretas 01.cbr"), "cbr");
    assert.equal(classifier.format("application/vnd.comicbook-rar", "x"), "cbr");
    // Generic mime: the extension decides, and it still is not a PDF.
    assert.equal(classifier.format("application/octet-stream", "Guerras 02.cbr"), "cbr");
    // A RAR with no extension at all is still not a PDF.
    assert.equal(classifier.format("application/x-rar-compressed", "Anual"), "cbr");
    assert.equal(classifier.isSupported("cbr"), false);
    assert.equal(classifier.isSupported("cbz"), false);
  });
  it("extensão estranha não engana: o mimeType manda", () => {
    assert.equal(classifier.format("application/pdf", "Capítulo 03.pdf.txt"), "pdf");
    // A specific type Lumeo does not know is unknown, never guessed from the name.
    assert.equal(classifier.format("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Capítulo 04.pdf"), "unknown");
  });
  it("sem extensão e sem tipo útil continua listado como desconhecido", () => {
    assert.equal(classifier.format("application/octet-stream", "notas"), "unknown");
    assert.equal(classifier.format("", "qualquer coisa"), "unknown");
  });
});

describe("listagem da pasta com os tipos reais", () => {
  const nodes = [
    { id: ROOT, name: "HQs da Marvel", mimeType: FOLDER, parent: null },
    ...files.map(file => ({ ...file, parent: ROOT })),
  ];
  const service = () => new DriveCollectionService([collection], new DriveFolderBrowser(drive(nodes)));

  it("2. PDF de HQ recebe contentType comic", async () => {
    const listing = await service().open("marvel-hqs");
    const pdf = listing.entries.find(entry => entry.id === "f-pdf")!;
    assert.equal(pdf.format, "pdf");
    assert.equal(pdf.contentType, "comic");
    assert.equal(pdf.supported, true);
  });
  it("5b. CBR aparece na pasta, marcado como não suportado", async () => {
    const listing = await service().open("marvel-hqs");
    const cbrs = listing.entries.filter(entry => entry.format === "cbr");
    assert.equal(cbrs.length, 3, "os três CBR - com mime próprio, genérico e sem extensão");
    cbrs.forEach(entry => { assert.equal(entry.supported, false); assert.equal(entry.contentType, undefined); });
  });
  it("nenhum item da pasta é descartado", async () => {
    const listing = await service().open("marvel-hqs");
    assert.equal(listing.entries.length, files.length);
    assert.deepEqual(listing.entries.filter(e => e.format === "unknown").map(e => e.id), ["f-desconhecido"]);
  });
  it("7. dois nomes iguais não colidem: a identidade é o fileId", async () => {
    const twins = [{ id: ROOT, name: "HQs da Marvel", mimeType: FOLDER, parent: null },
      { id: "a", name: "Capítulo 01.pdf", mimeType: "application/pdf", parent: ROOT },
      { id: "b", name: "Capítulo 01.pdf", mimeType: "application/pdf", parent: ROOT }];
    const listing = await new DriveCollectionService([collection], new DriveFolderBrowser(drive(twins))).open("marvel-hqs");
    assert.deepEqual(listing.entries.map(entry => entry.id), ["a", "b"]);
    assert.equal(new Set(listing.entries.map(entry => entry.id)).size, 2);
  });
});

describe("shortcuts", () => {
  const base = [{ id: ROOT, name: "HQs da Marvel", mimeType: FOLDER, parent: null },
    { id: "ok", name: "Atalho bom", mimeType: SHORTCUT, parent: ROOT, shortcutDetails: { targetId: "alvo", targetMimeType: "application/pdf" } },
    { id: "quebrado", name: "Atalho quebrado", mimeType: SHORTCUT, parent: ROOT, shortcutDetails: {} },
    { id: "normal", name: "Normal.pdf", mimeType: "application/pdf", parent: ROOT }];
  it("atalho válido é resolvido para o alvo", async () => {
    const listing = await new DriveCollectionService([collection], new DriveFolderBrowser(drive(base))).open("marvel-hqs");
    const resolved = listing.entries.find(entry => entry.name === "Atalho bom")!;
    assert.equal(resolved.id, "alvo", "o id passa a ser o do alvo, não o do atalho");
    assert.equal(resolved.format, "pdf");
    assert.equal(resolved.shortcut, true);
  });
  it("8. atalho quebrado não derruba a pasta, só gera aviso", async () => {
    const listing = await new DriveCollectionService([collection], new DriveFolderBrowser(drive(base))).open("marvel-hqs");
    assert.equal(listing.entries.some(entry => entry.name === "Atalho quebrado"), false);
    assert.deepEqual(listing.warnings.map(w => ({ code: w.code, name: w.name })), [{ code: "SHORTCUT_BROKEN", name: "Atalho quebrado" }]);
    assert.equal(listing.entries.some(entry => entry.name === "Normal.pdf"), true, "o resto da pasta continua");
  });
});

describe("9. rate limit do Drive", () => {
  const sleep = async () => undefined;
  it("403 rateLimitExceeded é tentado de novo com backoff", async () => {
    const limiter = new DriveRequestLimiter({ attempts: 3, sleep, random: () => 0.5, baseDelayMs: 1 });
    let calls = 0;
    const response = await limiter.run(async () => {
      calls++;
      if (calls < 3) return new Response(JSON.stringify({ error: { errors: [{ reason: "rateLimitExceeded" }] } }), { status: 403 });
      return new Response("{}", { status: 200 });
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 3);
    assert.equal(limiter.retries, 2);
  });
  it("429 e 503 também são tentados de novo", async () => {
    for (const status of [429, 503]) {
      const limiter = new DriveRequestLimiter({ attempts: 2, sleep, random: () => 0.5, baseDelayMs: 1 });
      let calls = 0;
      await limiter.run(async () => { calls++; return calls === 1 ? new Response("{}", { status }) : new Response("{}", { status: 200 }); });
      assert.equal(calls, 2, `status ${status}`);
    }
  });
  it("403 de permissão não é tentado de novo: só queimaria cota", async () => {
    const limiter = new DriveRequestLimiter({ attempts: 4, sleep, random: () => 0.5, baseDelayMs: 1 });
    let calls = 0;
    const response = await limiter.run(async () => { calls++; return new Response(JSON.stringify({ error: { errors: [{ reason: "insufficientFilePermissions" }] } }), { status: 403 }); });
    assert.equal(calls, 1);
    assert.equal(response.status, 403);
  });
  it("nenhuma tempestade: a concorrência fica no limite", async () => {
    const limiter = new DriveRequestLimiter({ concurrency: 2, attempts: 1, sleep });
    let active = 0, peak = 0;
    await Promise.all(Array.from({ length: 12 }, () => limiter.run(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--; return new Response("{}", { status: 200 });
    })));
    assert.equal(peak, 2);
  });
  it("o navegador de pastas passa pelo limitador", async () => {
    const limiter = new DriveRequestLimiter({ attempts: 2, sleep, random: () => 0.5, baseDelayMs: 1 });
    let calls = 0;
    const browser = new DriveFolderBrowser(async () => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }), { status: 403 });
      return new Response(JSON.stringify({ files: [{ id: "x", name: "A.pdf", mimeType: "application/pdf" }] }), { status: 200 });
    }, limiter);
    const entries = await browser.children(ROOT, collection);
    assert.equal(entries.length, 1);
    assert.equal(calls, 2);
  });
});

describe("10. referência guardada na biblioteca", () => {
  const entry = { id: "f-pdf", name: "Capítulo 01.pdf", kind: "file" as const, mimeType: "application/pdf",
    format: "pdf" as const, supported: true, contentType: "comic" as const, size: 1234, modifiedAt: null };
  it("guarda tudo que é preciso para reabrir sem varrer o Drive", () => {
    const reference = collectionLibraryReference(collection, "v1", [{ id: ROOT }, { id: "sw" }, { id: "v1" }], entry);
    assert.equal(reference.sourceId, "marvel-hqs");
    assert.equal(reference.driveFileId, "f-pdf");
    assert.equal(reference.title, "Capítulo 01");
    assert.equal(reference.mimeType, "application/pdf");
    assert.equal(reference.contentType, "comic");
    assert.equal(reference.folderId, "v1");
    assert.deepEqual(reference.folderPath, [ROOT, "sw", "v1"]);
    assert.match(reference.downloadUrl, /^https:\/\/drive\.google\.com\/uc\?export=download&id=f-pdf$/);
  });
  it("um CBR não pode virar item de biblioteca", () => {
    const cbr = { ...entry, id: "f-cbr", format: "cbr" as const, supported: false, contentType: undefined };
    assert.throws(() => collectionLibraryReference(collection, "v1", [], cbr), CollectionLibraryReferenceError);
  });
});
