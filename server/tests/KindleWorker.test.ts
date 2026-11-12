import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strToU8, unzipSync, zipSync, strFromU8 } from "fflate";
import sharp from "sharp";
import type { CatalogBookRecord } from "../src/catalog/types.js";
import { CalibreConverter, PermanentConversionError, ebookConvertArgs, type ConvertedEdition, type EditionConverter } from "../../worker/kindle-converter/src/CalibreConverter.js";
import { DriveRequestError, GoogleDriveEditionStore } from "../../worker/kindle-converter/src/DriveEditionStore.js";
import { EditionStoreUnavailable, MemoryEditionQueue, editionMetadata, planQueue, type EditionJob, type EditionStore } from "../../worker/kindle-converter/src/EditionQueue.js";
import { calibreMissingItems, checkEpub, checkPdf, inspectKf8, looksLikeHtml, repairEpub, resolveZipPath } from "../../worker/kindle-converter/src/KindleFiles.js";
import { KindleConversionWorker, type WatchedSource } from "../../worker/kindle-converter/src/KindleConversionWorker.js";

const book = (index: number, extra: Partial<CatalogBookRecord> = {}): CatalogBookRecord => ({
  bookId: `bk_${index}`, title: `Livro ${index}`, author: `Autora ${index}`, genreId: "autoajuda", genreName: "Autoajuda", coverUrl: `https://lh3.googleusercontent.com/d/capa${index}`,
  description: `Sinopse ${index}`, format: "epub", fileSize: 1000 + index, driveFileId: `arquivo${index}`, storageAccountId: "s", sha256: null,
  volume: null, collection: null, language: "pt", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z", status: "ACTIVE", ...extra });

/** A small but real EPUB 2 (mimetype first, container, OPF, NCX, two chapters, a cover). */
function epub(options: { brokenPaths?: boolean; chapters?: number } = {}): Uint8Array {
  const chapters = Array.from({ length: options.chapters ?? 2 }, (_, index) => index + 1);
  const prefix = options.brokenPaths ? "Text/Text/" : "Text/";
  const chapter = (n: number) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Capítulo ${n}</title></head><body><h1>Capítulo ${n}</h1>${"<p>Texto do capítulo com acentuação: ação, coração, você.</p>".repeat(40)}</body></html>`;
  const opf = `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Título interno</dc:title><dc:creator>Autor interno</dc:creator><dc:language>pt</dc:language><dc:identifier id="id">teste-1</dc:identifier></metadata>`
    + `<manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${chapters.map((n) => `<item id="c${n}" href="${prefix}c${n}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest>`
    + `<spine toc="ncx">${chapters.map((n) => `<itemref idref="c${n}"/>`).join("")}</spine></package>`;
  const ncx = `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="teste-1"/></head><docTitle><text>T</text></docTitle><navMap>${chapters.map((n) => `<navPoint id="n${n}" playOrder="${n}"><navLabel><text>Capítulo ${n}</text></navLabel><content src="${prefix}c${n}.xhtml"/></navPoint>`).join("")}</navMap></ncx>`;
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    "OEBPS/content.opf": strToU8(opf),
    "OEBPS/toc.ncx": strToU8(ncx),
  };
  for (const n of chapters) files[`OEBPS/Text/c${n}.xhtml`] = strToU8(chapter(n));
  return zipSync(files as never);
}

/** A minimal KF8 (AZW3) header with the EXTH records the Kindle library reads. */
function kf8(options: { version?: number; title?: string | null; author?: string | null; cover?: boolean; boundary?: boolean } = {}): Uint8Array {
  const records: Array<[number, Uint8Array]> = [];
  const text = (value: string) => new TextEncoder().encode(value);
  const u32 = (value: number) => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value); return bytes; };
  if (options.author !== null) records.push([100, text(options.author ?? "Autora")]);
  if (options.title !== null) records.push([503, text(options.title ?? "Título")]);
  if (options.cover !== false) records.push([201, u32(0)]);
  if (options.boundary) records.push([121, u32(5)]);
  records.push([501, text("EBOK")]);
  const exthBody = records.map(([type, value]) => { const out = new Uint8Array(8 + value.length); const view = new DataView(out.buffer); view.setUint32(0, type); view.setUint32(4, 8 + value.length); out.set(value, 8); return out; });
  const exthLength = 12 + exthBody.reduce((sum, item) => sum + item.length, 0);
  const headerLength = 232, record0 = 88;
  const total = record0 + 16 + headerLength + exthLength + 64;
  const bytes = new Uint8Array(total), view = new DataView(bytes.buffer);
  bytes.set(text("BOOKMOBI"), 60); view.setUint16(76, 2); view.setUint32(78, record0);
  const mobi = record0 + 16;
  bytes.set(text("MOBI"), mobi); view.setUint32(mobi + 4, headerLength); view.setUint32(mobi + 20, options.version ?? 8); view.setUint32(mobi + 0x70, 0x40);
  const exth = mobi + headerLength;
  bytes.set(text("EXTH"), exth); view.setUint32(exth + 4, exthLength); view.setUint32(exth + 8, records.length);
  let position = exth + 12;
  for (const item of exthBody) { bytes.set(item, position); position += item.length; }
  return bytes;
}

describe("worker Kindle: arquivos", () => {
  it("EPUB de verdade passa; página HTML do Drive, zip quebrado e vazio não", () => {
    assert.deepEqual(checkEpub(epub()), { ok: true });
    const html = new TextEncoder().encode("<!DOCTYPE html><html><body>Google Drive - Cota excedida</body></html>".padEnd(200, " "));
    assert.equal(looksLikeHtml(html), true);
    assert.match(checkEpub(html).reason!, /página HTML/);
    assert.match(checkEpub(new Uint8Array(100)).reason!, /não é um zip/);
    assert.match(checkEpub(new Uint8Array(3)).reason!, /vazio/);
    assert.match(checkEpub(zipSync({ "x.txt": strToU8("x") })).reason!, /container\.xml/);
  });

  it("AZW3: exige BOOKMOBI, KF8, título e autor internos; informa a capa", () => {
    assert.deepEqual(inspectKf8(kf8()), { ok: true, title: "Título", author: "Autora", language: undefined, hasCover: true, documentType: "EBOK" });
    assert.equal(inspectKf8(kf8({ version: 6, boundary: true })).ok, true, "MOBI6+KF8 conjunto também é KF8");
    assert.match(inspectKf8(kf8({ version: 6 })).reason!, /não KF8/);
    assert.match(inspectKf8(kf8({ title: null })).reason!, /sem título/);
    assert.match(inspectKf8(kf8({ author: null })).reason!, /sem autor/);
    assert.equal(inspectKf8(kf8({ cover: false })).hasCover, false);
    assert.match(inspectKf8(new TextEncoder().encode("<html>".padEnd(200))).reason!, /não é um livro/);
    assert.match(inspectKf8(kf8().subarray(0, 50)).reason!, /truncado/);
  });

  it("PDF completo", () => {
    assert.equal(checkPdf(new TextEncoder().encode(`%PDF-1.7\n${"x".repeat(100)}\n%%EOF\n`)).ok, true);
    assert.match(checkPdf(new TextEncoder().encode(`%PDF-1.7\n${"x".repeat(100)}`)).reason!, /truncado/);
  });

  it("repara EPUB com capítulos apontando para a pasta errada (Text/Text/...) e o sumário junto", () => {
    const broken = epub({ brokenPaths: true });
    const repaired = repairEpub(broken);
    assert.equal(repaired.fixed, 2); assert.deepEqual(repaired.missing, []);
    const files = unzipSync(repaired.bytes);
    const opf = strFromU8(files["OEBPS/content.opf"]!), ncx = strFromU8(files["OEBPS/toc.ncx"]!);
    assert.match(opf, /href="Text\/c1\.xhtml"/); assert.doesNotMatch(opf, /Text\/Text/);
    assert.match(ncx, /src="Text\/c2\.xhtml"/);
    assert.equal(Object.keys(files)[0], "mimetype", "mimetype continua o primeiro");
    assert.deepEqual(checkEpub(repaired.bytes), { ok: true });
    const intact = epub();
    assert.equal(repairEpub(intact).bytes, intact, "EPUB correto não é reescrito");
  });

  it("caminhos dentro do zip e itens ausentes no log do Calibre", () => {
    assert.equal(resolveZipPath("OEBPS/", "../Images/a%20b.jpg#x"), "Images/a b.jpg");
    assert.deepEqual(calibreMissingItems("Parsing all content...\nManifest item 'OEBPS/Text/Text/a.html' not found\nManifest item 'OEBPS/x.jpg' not found"), ["OEBPS/Text/Text/a.html", "OEBPS/x.jpg"]);
  });
});

describe("worker Kindle: argumentos do Calibre", () => {
  it("título, autor, idioma, sinopse e capa do catálogo, cada um como argumento separado", () => {
    const meta = editionMetadata(book(1, { author: "Ana & Bia", description: "Linha 1\nLinha \"2\"", collection: "Série X", volume: "2" }), "Editora");
    const args = ebookConvertArgs("/t/in.epub", "/t/out.azw3", meta, "/t/capa.jpg");
    assert.deepEqual(args.slice(0, 4), ["/t/in.epub", "/t/out.azw3", "--output-profile", "kindle_pw3"]);
    const value = (name: string) => args[args.indexOf(name) + 1];
    assert.equal(value("--title"), "Livro 1"); assert.equal(value("--authors"), "Ana e Bia", "& separaria autores no Calibre");
    assert.equal(value("--language"), "pt"); assert.equal(value("--comments"), "Linha 1\nLinha \"2\"");
    assert.equal(value("--cover"), "/t/capa.jpg"); assert.equal(value("--publisher"), "Editora");
    assert.equal(value("--series"), "Série X"); assert.equal(value("--series-index"), "2");
  });

  it("sem autor no catálogo mantém o do EPUB; sem capa, sem sinopse e volume não numérico ficam de fora", () => {
    const args = ebookConvertArgs("i", "o", editionMetadata(book(1, { author: "Autor não informado", description: null, coverUrl: "", collection: "S", volume: "especial" })), null);
    for (const flag of ["--authors", "--comments", "--cover", "--series-index"]) assert.equal(args.includes(flag), false, flag);
  });
});

describe("worker Kindle: fila", () => {
  const known = (job: EditionJob) => ({ epubDriveFileId: job.epubDriveFileId, epubSha256: job.epubSha256, metadata: job.metadata, status: "ready" as const });

  it("enfileira só EPUBs novos ou alterados (arquivo, sha256 ou dados do catálogo); PDF fica de fora", () => {
    const books = [book(1), book(2), book(3, { format: "pdf" }), book(4)];
    const first = planQueue("opds-autoajuda", 10, books, new Map());
    assert.deepEqual(first.jobs.map((job) => job.bookId), ["bk_1", "bk_2", "bk_4"]); assert.equal(first.skipped, 1);
    const state = new Map(first.jobs.map((job) => [job.bookId, known(job)]));
    const changed = [book(1, { driveFileId: "outro" }), book(2, { title: "Título corrigido" }), book(4)];
    const second = planQueue("opds-autoajuda", 10, changed, state);
    assert.deepEqual(second.jobs.map((job) => job.bookId), ["bk_1", "bk_2"]); assert.equal(second.unchanged, 1);
    assert.equal(planQueue("s", 10, [book(4, { sha256: "a".repeat(64) })], state).jobs.length, 1, "sha256 novo reconverte");
  });
});

class FakeConverter implements EditionConverter {
  public readonly seen: string[] = [];
  public constructor(private readonly outcome: (job: EditionJob) => ConvertedEdition | Error) {}
  public async convert(job: EditionJob) { this.seen.push(job.bookId); const result = this.outcome(job); if (result instanceof Error) throw result; return result; }
}
const converted = (size = 5000): ConvertedEdition => ({ format: "azw3", bytes: new Uint8Array(size), sha256: "f".repeat(64), info: { ok: true, title: "T" }, coverSource: "catalog", repairedPaths: 0 });

function workerWith(converter: EditionConverter, books: CatalogBookRecord[], options: { saveFails?: (call: number) => Error | null; sources?: WatchedSource[] } = {}) {
  const queue = new MemoryEditionQueue(), logs: Array<{ event: string; data?: Record<string, unknown> }> = [];
  const saves: Array<{ bookId: string; name: string; size: number; previous: string | null }> = [];
  const store: EditionStore = {
    save: async (job, file) => {
      const failure = options.saveFails?.(saves.length + 1) ?? null;
      saves.push({ bookId: job.bookId, name: file.name, size: file.bytes.length, previous: job.driveFileId });
      if (failure) throw failure;
      // Same book, same Drive file: a new conversion overwrites it.
      return { driveFileId: job.driveFileId ?? `drive_${job.bookId}_0000`, size: file.bytes.length, md5: "m" };
    },
  };
  const sources = options.sources ?? [{ sourceId: "opds-autoajuda", priority: 10, locale: "pt-BR", catalog: { list: async (query) => ({ items: books.slice(query.offset, query.offset + query.limit), nextCursor: query.offset + query.limit < books.length ? "n" : null }) } }];
  const worker = new KindleConversionWorker(sources, queue, store, converter, { workerId: "w1", maxAttempts: 3, staleAfterMinutes: 30 }, (event, data) => logs.push({ event, data }));
  return { worker, queue, saves, logs };
}

describe("worker Kindle: detectar → enfileirar → converter → salvar", () => {
  it("varre o Drive pelo catálogo (todas as páginas), converte e guarda só o vínculo com o arquivo do Drive", async () => {
    const books = Array.from({ length: 620 }, (_, index) => book(index + 1));
    const { worker, queue, saves } = workerWith(new FakeConverter(() => converted()), books);
    assert.equal(await worker.scan(), 620, "passa da 1ª página de 500");
    assert.equal(await worker.scan(), 0, "nada muda, nada é enfileirado de novo");
    assert.equal(await worker.processNext(), true);
    const row = queue.rows.get("bk_1")!;
    assert.equal(row.status, "ready");
    assert.deepEqual(row.edition, { format: "azw3", driveFileId: "drive_bk_1_0000", size: 5000, sha256: "f".repeat(64) }, "id do Drive, tamanho, checksum e formato; nenhum byte");
    assert.equal(row.epubDriveFileId, "arquivo1", "vínculo com o EPUB original");
    assert.deepEqual(saves, [{ bookId: "bk_1", name: "Autora 1 - Livro 1.azw3", size: 5000, previous: null }]);
  });

  it("livro alterado no catálogo: reconvertido por cima do mesmo arquivo do Drive (sem apagar, sem duplicar)", async () => {
    let title = "Livro 1";
    const catalog: WatchedSource = { sourceId: "opds-autoajuda", priority: 10, locale: "pt-BR", catalog: { list: async () => ({ items: [book(1, { title })], nextCursor: null }) } };
    const { worker, queue, saves } = workerWith(new FakeConverter(() => converted()), [], { sources: [catalog] });
    await worker.scan(); await worker.processNext();
    title = "Livro 1 (edição revista)";
    assert.equal(await worker.scan(), 1);
    assert.equal(queue.rows.get("bk_1")!.driveFileId, "drive_bk_1_0000", "a fila lembra o arquivo anterior");
    await worker.processNext();
    assert.equal(saves[1]!.previous, "drive_bk_1_0000"); assert.equal(saves[1]!.name, "Autora 1 - Livro 1 (edição revista).azw3");
    assert.equal(queue.rows.get("bk_1")!.edition?.driveFileId, "drive_bk_1_0000");
  });

  it("a pasta Autoajuda vem antes das outras", async () => {
    const order: string[] = [];
    const source = (sourceId: string, priority: number, id: number): WatchedSource => ({ sourceId, priority, locale: "pt-BR", catalog: { list: async () => ({ items: [book(id)], nextCursor: null }) } });
    const { worker } = workerWith(new FakeConverter((job) => { order.push(job.sourceId); return converted(); }), [], { sources: [source("outra", 50, 2), source("opds-autoajuda", 10, 1)] });
    await worker.scan();
    while (await worker.processNext()) { /* drain */ }
    assert.deepEqual(order, ["opds-autoajuda", "outra"]);
  });

  it("falha permanente (EPUB quebrado) → failed na hora; falha passageira → tenta de novo até o limite", async () => {
    const { worker, queue, logs } = workerWith(new FakeConverter((job) => job.bookId === "bk_1" ? new PermanentConversionError("EPUB corrompido") : new Error("o Drive respondeu 500")), [book(1), book(2)]);
    await worker.scan();
    let rounds = 0;
    while (await worker.processNext()) rounds++;
    assert.equal(queue.rows.get("bk_1")!.status, "failed"); assert.equal(queue.rows.get("bk_1")!.attempts, 1);
    assert.equal(queue.rows.get("bk_2")!.status, "failed"); assert.equal(queue.rows.get("bk_2")!.attempts, 3); assert.equal(queue.rows.get("bk_2")!.lastError, "o Drive respondeu 500");
    assert.equal(rounds, 4);
    assert.equal(logs.filter((log) => log.event === "KINDLE_RETRY_LATER").length, 2);
  });

  it("Drive fora do ar: não marca pronto, devolve à fila sem gastar tentativa e o worker para de pegar livros", async () => {
    const { worker, queue, logs } = workerWith(new FakeConverter(() => converted()), [book(1)], { saveFails: () => new EditionStoreUnavailable("Drive 503: backendError") });
    await worker.scan();
    for (let round = 0; round < 5; round++) await assert.rejects(worker.processNext(), EditionStoreUnavailable);
    const row = queue.rows.get("bk_1")!;
    assert.equal(row.status, "pending"); assert.equal(row.attempts, 0, "5 quedas do Drive não queimam as 3 tentativas"); assert.match(row.lastError!, /Drive 503/);
    assert.equal(row.edition, null);
    assert.equal(logs.filter((log) => log.event === "KINDLE_STORE_UNAVAILABLE").length, 5);
  });

  it("Drive recusou o arquivo (400): conta como tentativa do livro, até falhar", async () => {
    const { worker, queue } = workerWith(new FakeConverter(() => converted()), [book(1)], { saveFails: () => new DriveRequestError(400, "Drive 400: invalid name") });
    await worker.scan();
    while (await worker.processNext()) { /* drain */ }
    assert.equal(queue.rows.get("bk_1")!.status, "failed"); assert.equal(queue.rows.get("bk_1")!.attempts, 3);
  });

  it("Drive cai no meio da fila: o worker espera (não fica reconvertendo em laço)", async () => {
    const converter = new FakeConverter(() => converted());
    const { worker } = workerWith(converter, [book(1), book(2), book(3)], { saveFails: (call) => call >= 2 ? new EditionStoreUnavailable("Drive 503") : null });
    const stop = new AbortController();
    const running = worker.run(stop.signal, { scanIntervalMs: 60_000, idleMs: 1_000 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    stop.abort(); await running;
    assert.equal(converter.seen.length, 2, "1 livro salvo, 1 devolvido à fila, e então espera");
  });

  it("uma pasta ilegível não impede as outras", async () => {
    const broken: WatchedSource = { sourceId: "quebrada", priority: 1, locale: "pt-BR", catalog: { list: async () => { throw new Error("catalog.json inválido"); } } };
    const fine: WatchedSource = { sourceId: "opds-autoajuda", priority: 10, locale: "pt-BR", catalog: { list: async () => ({ items: [book(1)], nextCursor: null }) } };
    const { worker, logs } = workerWith(new FakeConverter(() => converted()), [], { sources: [broken, fine] });
    assert.equal(await worker.scan(), 1);
    assert.equal(logs[0]!.event, "KINDLE_SCAN_FAILED");
  });

  it("para quando recebe o sinal (SIGTERM do Docker)", async () => {
    const { worker } = workerWith(new FakeConverter(() => converted()), [book(1)]);
    const stop = new AbortController();
    const running = worker.run(stop.signal, { scanIntervalMs: 60_000, idleMs: 60_000 });
    setTimeout(() => stop.abort(), 50);
    await running;
  });
});

/** A tiny Google: OAuth token, Drive files/permissions and resumable uploads, in memory. */
class FakeGoogle {
  public readonly calls: Array<{ method: string; url: string; body?: unknown }> = [];
  public readonly files = new Map<string, { name: string; mimeType: string; parents: string[]; trashed: boolean; appProperties: Record<string, string>; bytes?: Uint8Array; permissions: Array<{ type: string; role: string }> }>();
  public tokenError: string | null = null;
  public fail: (method: string, url: string) => { status: number; reason: string } | null = () => null;
  public corruptUpload = false;
  public tokens = 0;
  private sessions = new Map<string, { existing: string | null; metadata: Record<string, unknown> }>();
  private next = 1;

  public folder(name: string, parents = ["root"]) { const id = `folder_${this.next++}_xxxxxxxx`; this.files.set(id, { name, mimeType: "application/vnd.google-apps.folder", parents, trashed: false, appProperties: {}, permissions: [] }); return id; }
  public byBook(bookId: string) { return [...this.files.entries()].filter(([, file]) => file.appProperties.lumeoBookId === bookId); }

  public readonly fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input)), method = init.method ?? "GET";
    const body = typeof init.body === "string" ? (init.body.startsWith("{") ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body))) : init.body;
    this.calls.push({ method, url: url.toString(), body });
    const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
    if (url.host === "oauth2.googleapis.com") {
      if (this.tokenError) return json({ error: this.tokenError }, 400);
      this.tokens++; return json({ access_token: `at${this.tokens}`, expires_in: 3600 });
    }
    const failure = this.fail(method, url.toString());
    if (failure) return json({ error: { message: failure.reason, errors: [{ reason: failure.reason }] } }, failure.status);
    const path = url.pathname, q = url.searchParams.get("q") ?? "";
    if (method === "PUT" && url.searchParams.has("upload_id")) {
      const session = this.sessions.get(url.searchParams.get("upload_id")!)!;
      const bytes = new Uint8Array(body as Uint8Array), id = session.existing ?? `azw3_${this.next++}_xxxxxxxx`;
      const previous = this.files.get(id);
      this.files.set(id, { name: String(session.metadata.name), mimeType: String(session.metadata.mimeType), parents: previous?.parents ?? (session.metadata.parents as string[]), trashed: false, appProperties: session.metadata.appProperties as Record<string, string>, bytes, permissions: previous?.permissions ?? [] });
      const md5 = this.corruptUpload ? "0".repeat(32) : createHash("md5").update(bytes).digest("hex");
      return json({ id, size: String(bytes.length), md5Checksum: md5, trashed: false });
    }
    if (path.startsWith("/upload/drive/v3/files")) {
      const existing = path.split("/")[5] ?? null, uploadId = `u${this.next++}`;
      this.sessions.set(uploadId, { existing, metadata: body as Record<string, unknown> });
      return new Response(null, { status: 200, headers: { location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${uploadId}` } });
    }
    const [, , , , id, sub] = path.split("/");
    if (!id && method === "GET") {
      const list = [...this.files.entries()].filter(([, file]) => !file.trashed && (
        q.includes("mimeType = 'application/vnd.google-apps.folder'") ? file.mimeType.endsWith("folder") && q.includes(`name = '${file.name}'`) && file.parents.includes("root")
          : q.includes("appProperties has") && q.includes(`value='${file.appProperties.lumeoBookId}'`) && file.parents.some((parent) => q.startsWith(`'${parent}' in parents`))));
      return json({ files: list.map(([fileId]) => ({ id: fileId })) });
    }
    if (!id && method === "POST") { const created = this.folder((body as { name: string }).name); return json({ id: created }); }
    const file = this.files.get(id!);
    if (!file) return json({ error: { message: "File not found", errors: [{ reason: "notFound" }] } }, 404);
    if (sub === "permissions" && method === "GET") return json({ permissions: file.permissions });
    if (sub === "permissions" && method === "POST") { file.permissions.push(body as { type: string; role: string }); return json({ id: "anyoneWithLink" }); }
    if (method === "GET") return json({ id, mimeType: file.mimeType, trashed: file.trashed, parents: file.parents });
    return json({ error: { message: "unexpected" } }, 500);
  }) as unknown as typeof fetch;
}

describe("worker Kindle: pasta Lumeo Kindle AZW3 no Google Drive", () => {
  const oauth = { clientId: "cid", clientSecret: "secret", refreshToken: "refresh" };
  const job = (bookId = "bk_1", driveFileId: string | null = null): EditionJob => ({ bookId, sourceId: "opds-autoajuda", priority: 10, attempts: 1, epubDriveFileId: "epubOriginal_123", epubSha256: null, metadata: editionMetadata(book(1)), driveFileId });
  const file = (size = 3000, fill = 7) => ({ name: "Autora 1 - Livro 1.azw3", bytes: new Uint8Array(size).fill(fill), sha256: "a".repeat(64) });

  it("cria a pasta na raiz, compartilha por link (leitura) e envia o AZW3 conferindo tamanho e MD5", async () => {
    const google = new FakeGoogle(), store = new GoogleDriveEditionStore(oauth, {}, google.fetch);
    const saved = await store.save(job(), file());
    const [folderId, folder] = [...google.files.entries()].find(([, entry]) => entry.mimeType.endsWith("folder"))!;
    assert.equal(folder.name, "Lumeo Kindle AZW3"); assert.deepEqual(folder.parents, ["root"]);
    assert.deepEqual(folder.permissions, [{ type: "anyone", role: "reader", allowFileDiscovery: false }], "o Kindle baixa sem login Google, como os EPUBs do catálogo");
    const stored = google.files.get(saved.driveFileId)!;
    assert.deepEqual(stored.parents, [folderId]); assert.equal(stored.mimeType, "application/vnd.amazon.mobi8-ebook"); assert.equal(stored.name, "Autora 1 - Livro 1.azw3");
    assert.deepEqual(stored.appProperties, { lumeoBookId: "bk_1", lumeoEpubFileId: "epubOriginal_123", lumeoSha256: "a".repeat(64) });
    assert.equal(stored.bytes!.length, 3000); assert.equal(saved.size, 3000); assert.equal(saved.md5, createHash("md5").update(file().bytes).digest("hex"));
    await store.save(job("bk_2"), file());
    assert.equal(google.calls.filter((call) => call.url.includes("google-apps.folder")).length, 1, "a pasta é procurada uma vez só");
    assert.equal(google.calls.filter((call) => call.method === "DELETE").length, 0, "nada é apagado");
    assert.ok(google.calls.every((call) => /^https:\/\/(www\.googleapis\.com|oauth2\.googleapis\.com)\//.test(call.url)));
    assert.ok(!google.calls.some((call) => call.url.includes("epubOriginal_123/") || call.url.includes("files/epubOriginal_123")), "o EPUB original nunca é tocado");
  });

  it("usa a pasta que já existe (não cria outra) e não repete o compartilhamento", async () => {
    const google = new FakeGoogle(), existing = google.folder("Lumeo Kindle AZW3");
    google.files.get(existing)!.permissions.push({ type: "anyone", role: "reader" });
    const store = new GoogleDriveEditionStore(oauth, {}, google.fetch);
    assert.equal(await store.folderId(), existing);
    assert.equal([...google.files.values()].filter((entry) => entry.mimeType.endsWith("folder")).length, 1);
    assert.equal(google.calls.filter((call) => call.method === "POST" && call.url.includes("/permissions")).length, 0);
  });

  it("reconversão sobrescreve o mesmo arquivo (mesmo id), inclusive quando o vínculo se perdeu; nunca duplica", async () => {
    const google = new FakeGoogle(), store = new GoogleDriveEditionStore(oauth, {}, google.fetch);
    const first = await store.save(job(), file(3000, 1));
    const again = await store.save(job("bk_1", first.driveFileId), file(4000, 2));
    assert.equal(again.driveFileId, first.driveFileId);
    const patch = google.calls.find((call) => call.method === "PATCH")!;
    assert.match(patch.url, new RegExp(`/upload/drive/v3/files/${first.driveFileId}\\?uploadType=resumable`));
    assert.equal((patch.body as { parents?: unknown }).parents, undefined, "não muda de pasta");
    // Upload done but the database never got the id (worker died): found by its tag.
    const lost = await store.save(job("bk_1", null), file(5000, 3));
    assert.equal(lost.driveFileId, first.driveFileId);
    assert.equal(google.byBook("bk_1").length, 1); assert.equal(google.files.get(first.driveFileId)!.bytes!.length, 5000);
  });

  it("arquivo anterior na lixeira ou fora da pasta: envia um novo", async () => {
    const google = new FakeGoogle(), store = new GoogleDriveEditionStore(oauth, {}, google.fetch);
    const first = await store.save(job(), file());
    google.files.get(first.driveFileId)!.trashed = true;
    const next = await store.save(job("bk_1", first.driveFileId), file());
    assert.notEqual(next.driveFileId, first.driveFileId);
    assert.equal(google.files.get(first.driveFileId)!.trashed, true, "o da lixeira fica como está");
  });

  it("arquivo no Drive diferente do convertido (MD5) → erro do livro, não 'pronto'", async () => {
    const google = new FakeGoogle(), store = new GoogleDriveEditionStore(oauth, {}, google.fetch);
    google.corruptUpload = true;
    await assert.rejects(store.save(job(), file()), (error: Error) => !(error instanceof EditionStoreUnavailable) && /não confere/.test(error.message));
  });

  it("login revogado, cota, limite de uso e Google fora do ar → 'Drive indisponível'; 400 → erro do livro", async () => {
    const revoked = new FakeGoogle(); revoked.tokenError = "invalid_grant";
    await assert.rejects(new GoogleDriveEditionStore(oauth, {}, revoked.fetch).save(job(), file()), (error: Error) => error instanceof EditionStoreUnavailable && /drive-auth/.test(error.message));
    for (const [status, reason] of [[403, "storageQuotaExceeded"], [429, "userRateLimitExceeded"], [503, "backendError"]] as const) {
      const google = new FakeGoogle(); google.fail = (method, url) => method === "POST" && url.includes("/upload/") ? { status, reason } : null;
      await assert.rejects(new GoogleDriveEditionStore(oauth, {}, google.fetch).save(job(), file()), (error: Error) => error instanceof EditionStoreUnavailable && error.message.includes(reason));
    }
    const refused = new FakeGoogle(); refused.fail = (method, url) => method === "POST" && url.includes("/upload/") ? { status: 400, reason: "invalidName" } : null;
    await assert.rejects(new GoogleDriveEditionStore(oauth, {}, refused.fetch).save(job(), file()), (error: Error) => error instanceof DriveRequestError && !(error instanceof EditionStoreUnavailable));
    const down = new FakeGoogle(); let first = true;
    down.fail = (method, url) => url.includes("google-apps.folder") && first ? (first = false, { status: 503, reason: "backendError" }) : null;
    const store = new GoogleDriveEditionStore(oauth, {}, down.fetch);
    await assert.rejects(store.folderId(), EditionStoreUnavailable);
    assert.match(await store.folderId(), /^folder_/, "depois de uma queda, tenta de novo (não guarda o erro)");
  });

  it("token vencido no meio (401): renova uma vez e segue", async () => {
    const google = new FakeGoogle(); let once = true;
    google.fail = (method) => method === "PUT" && once ? (once = false, { status: 401, reason: "authError" }) : null;
    await new GoogleDriveEditionStore(oauth, {}, google.fetch).save(job(), file());
    assert.equal(google.tokens, 2);
  });

  it("sem as credenciais do Drive o worker nem começa", () => {
    assert.throws(() => new GoogleDriveEditionStore({ ...oauth, refreshToken: "" }), /drive-auth/);
    assert.throws(() => new GoogleDriveEditionStore(oauth, { folderId: "../x" }), /KINDLE_DRIVE_FOLDER_ID/);
  });
});

const calibre = process.env.CALIBRE_BIN ?? join(homedir(), "calibre-bin", "calibre");
/** Runs only where Calibre is installed and starts (the worker's image, or a machine set up for it). */
// Converting loads Qt (which needs libOpenGL & co.); "--version" alone does not, so Qt is checked.
const calibreWorks = existsSync(join(calibre, "ebook-convert")) && spawnSync(join(calibre, "calibre-debug"), ["-c", "from qt.core import QColor, QImage"], { timeout: 60_000 }).status === 0;
describe("worker Kindle: conversão real com Calibre", { skip: !calibreWorks && "Calibre indisponível aqui" }, () => {
  const job = (bytes: Uint8Array): { job: EditionJob; fetcher: typeof fetch } => {
    const cover = sharp({ create: { width: 600, height: 900, channels: 3, background: "#225" } }).jpeg().toBuffer();
    const fetcher = (async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith("https://drive.usercontent.google.com/download")) return new Response(new Uint8Array(bytes));
      if (url.includes("googleusercontent.com/d/")) return new Response(new Uint8Array(await cover), { headers: { "content-type": "image/jpeg" } });
      return new Response("não", { status: 404 });
    }) as unknown as typeof fetch;
    const record = book(1, { title: "Clareza & Conexão", author: "Yung Pueblo", description: "Sinopse do catálogo." });
    return { fetcher, job: { bookId: record.bookId, sourceId: "s", priority: 10, attempts: 1, epubDriveFileId: record.driveFileId, epubSha256: null, metadata: editionMetadata(record), driveFileId: null } };
  };
  const converter = (fetcher: typeof fetch) => new CalibreConverter({ calibreBin: calibre, maxEpubBytes: 50 * 1048576, convertTimeoutMs: 180_000, downloadTimeoutMs: 30_000 }, fetcher);

  it("EPUB → AZW3 com título, autor, idioma e capa do catálogo dentro do arquivo", { timeout: 200_000 }, async () => {
    const { job: item, fetcher } = job(epub());
    const result = await converter(fetcher).convert(item);
    assert.equal(result.info.ok, true); assert.equal(result.info.title, "Clareza & Conexão"); assert.equal(result.info.author, "Yung Pueblo");
    assert.equal(result.info.hasCover, true); assert.equal(result.info.documentType, "EBOK"); assert.equal(result.coverSource, "catalog");
    assert.equal(result.info.language, "pt");
  });

  it("EPUB com caminhos quebrados sai completo depois do reparo", { timeout: 200_000 }, async () => {
    const { job: item, fetcher } = job(epub({ brokenPaths: true, chapters: 3 }));
    const result = await converter(fetcher).convert(item);
    assert.equal(result.repairedPaths, 3);
    assert.ok(result.bytes.length > 3000, String(result.bytes.length));
  });

  it("Drive devolvendo página HTML: erro passageiro (nova tentativa), nunca um AZW3", { timeout: 60_000 }, async () => {
    const { job: item } = job(epub());
    const html = (async () => new Response("<!DOCTYPE html><html>cota</html>".padEnd(300))) as unknown as typeof fetch;
    await assert.rejects(converter(html).convert(item), (error: Error) => !(error instanceof PermanentConversionError) && /página HTML/.test(error.message));
  });
});
