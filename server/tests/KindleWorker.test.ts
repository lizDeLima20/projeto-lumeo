import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strToU8, unzipSync, zipSync, strFromU8 } from "fflate";
import sharp from "sharp";
import type { CatalogBookRecord } from "../src/catalog/types.js";
import { CalibreConverter, PermanentConversionError, ebookConvertArgs, type ConvertedEdition, type EditionConverter } from "../../worker/kindle-converter/src/CalibreConverter.js";
import { MemoryEditionQueue, editionMetadata, editionPath, planQueue, type EditionJob, type EditionStorage } from "../../worker/kindle-converter/src/EditionQueue.js";
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

  it("caminho no armazenamento: um arquivo por livro, sem caracteres perigosos", () => {
    assert.equal(editionPath("opds-autoajuda", "bk_abc"), "opds-autoajuda/bk_abc.azw3");
    assert.equal(editionPath("s", "../../x y/z"), "s/__.._x_y_z.azw3", "sem barras: não sai da pasta da fonte");
  });
});

class FakeConverter implements EditionConverter {
  public readonly seen: string[] = [];
  public constructor(private readonly outcome: (job: EditionJob) => ConvertedEdition | Error) {}
  public async convert(job: EditionJob) { this.seen.push(job.bookId); const result = this.outcome(job); if (result instanceof Error) throw result; return result; }
}
const converted = (size = 5000): ConvertedEdition => ({ format: "azw3", bytes: new Uint8Array(size), sha256: "f".repeat(64), info: { ok: true, title: "T" }, coverSource: "catalog", repairedPaths: 0 });

function workerWith(converter: EditionConverter, books: CatalogBookRecord[], options: { uploadFails?: boolean; sources?: WatchedSource[] } = {}) {
  const queue = new MemoryEditionQueue(), uploads = new Map<string, Uint8Array>(), removed: string[] = [], logs: Array<{ event: string; data?: Record<string, unknown> }> = [];
  const storage: EditionStorage = {
    upload: async (path, bytes) => { if (options.uploadFails) throw new Error("storage 503"); uploads.set(path, bytes); },
    remove: async (path) => { removed.push(path); },
  };
  const sources = options.sources ?? [{ sourceId: "opds-autoajuda", priority: 10, locale: "pt-BR", catalog: { list: async (query) => ({ items: books.slice(query.offset, query.offset + query.limit), nextCursor: query.offset + query.limit < books.length ? "n" : null }) } }];
  const worker = new KindleConversionWorker(sources, queue, storage, converter, { workerId: "w1", maxAttempts: 3, staleAfterMinutes: 30 }, (event, data) => logs.push({ event, data }));
  return { worker, queue, uploads, removed, logs };
}

describe("worker Kindle: detectar → enfileirar → converter → salvar", () => {
  it("varre o Drive pelo catálogo (todas as páginas), converte e marca pronto com o arquivo salvo", async () => {
    const books = Array.from({ length: 620 }, (_, index) => book(index + 1));
    const { worker, queue, uploads } = workerWith(new FakeConverter(() => converted()), books);
    assert.equal(await worker.scan(), 620, "passa da 1ª página de 500");
    assert.equal(await worker.scan(), 0, "nada muda, nada é enfileirado de novo");
    assert.equal(await worker.processNext(), true);
    const row = queue.rows.get("bk_1")!;
    assert.equal(row.status, "ready"); assert.equal(row.edition?.storagePath, "opds-autoajuda/bk_1.azw3"); assert.equal(row.edition?.size, 5000);
    assert.ok(uploads.has("opds-autoajuda/bk_1.azw3"));
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

  it("armazenamento fora do ar não marca pronto", async () => {
    const { worker, queue } = workerWith(new FakeConverter(() => converted()), [book(1)], { uploadFails: true });
    await worker.scan(); await worker.processNext();
    assert.equal(queue.rows.get("bk_1")!.status, "pending"); assert.match(queue.rows.get("bk_1")!.lastError!, /storage 503/);
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
    return { fetcher, job: { bookId: record.bookId, sourceId: "s", priority: 10, attempts: 1, epubDriveFileId: record.driveFileId, epubSha256: null, metadata: editionMetadata(record), storagePath: null } };
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
