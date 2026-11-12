import assert from "node:assert/strict";
import { describe, it } from "node:test";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import type { IncomingMessage, ServerResponse } from "node:http";
import { OpdsController, OPDS_PAGE_SIZE, type OpdsCatalog } from "../src/opds/OpdsController.js";
import { OpdsAuth, OPDS_LOGIN_MAX_FAILURES } from "../src/opds/OpdsAuth.js";
import { OpdsCoverService } from "../src/opds/OpdsCoverService.js";
import { OpdsDownloadService, opdsDownloadUrl } from "../src/opds/OpdsDownloadService.js";
import { opdsFormatLabel, opdsLanguageName, xml } from "../src/opds/OpdsFeedBuilder.js";
import type { OpdsStore, OpdsUser } from "../src/opds/OpdsUserRepository.js";
import type { CatalogBookRecord, CatalogPage, CatalogQuery } from "../src/catalog/types.js";
import { ServerApp, opdsAutoajudaSource, opdsSourceCatalog } from "../src/app.js";
import { Config } from "../src/config/Config.js";
import { ApiError } from "../src/errors/ApiError.js";
import { SupabaseKindleEditions, kindleDownloadUrl, kindleOffer, type KindleEdition, type KindleEditionReader } from "../src/kindle/KindleEditions.js";
import { kindleFileName } from "../src/opds/KindleCatalogJson.js";

const PASSWORD = "senha-de-teste-123";
const hash = bcrypt.hashSync(PASSWORD, 4);

class MemoryStore implements OpdsStore {
  public readonly users = new Map<string, OpdsUser>([["leitor", { id: "u1", username: "leitor", passwordHash: hash, active: true }], ["parado", { id: "u2", username: "parado", passwordHash: hash, active: false }]]);
  public readonly attempts: Array<{ username: string; ip: string; at: Date }> = [];
  public readonly downloads: Array<{ userId: string; bookId: string; at: Date }> = [];
  public async findUser(username: string) { return this.users.get(username) ?? null; }
  public async failures(username: string, ip: string, since: Date) {
    const recent = this.attempts.filter(item => item.at >= since);
    return { forUser: recent.filter(item => item.username === username && item.ip === ip).length, forIp: recent.filter(item => item.ip === ip).length };
  }
  public async recordFailure(username: string, ip: string) { this.attempts.push({ username, ip, at: new Date() }); }
  public async downloadsSince(userId: string, since: Date) { return this.downloads.filter(item => item.userId === userId && item.at >= since).length; }
  public async recordDownload(userId: string, bookId: string) { this.downloads.push({ userId, bookId, at: new Date() }); }
}

const book = (index: number, extra: Partial<CatalogBookRecord> = {}): CatalogBookRecord => ({
  bookId: `livro-${index}`, title: `Livro ${index}`, author: `Autora ${index}`, genreId: "romance", genreName: "Romance", coverUrl: `https://drive.google.com/thumbnail?id=capa${index}&sz=w480-h640`,
  description: `Sinopse ${index}`, format: index % 2 ? "pdf" : "epub", fileSize: 1000 + index, driveFileId: `arquivo${index}`, storageAccountId: "s", sha256: null,
  volume: null, collection: null, language: "pt-BR", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z", status: "ACTIVE", ...extra });

class FakeCatalog implements OpdsCatalog {
  public readonly queries: CatalogQuery[] = [];
  public constructor(public readonly books: CatalogBookRecord[]) {}
  public async list(query: CatalogQuery): Promise<CatalogPage> {
    this.queries.push(query);
    const filtered = this.books.filter(item => (!query.genreId || item.genreId === query.genreId) && (!query.query || `${item.title} ${item.author}`.toLowerCase().includes(query.query.toLowerCase())));
    const page = filtered.slice(query.offset, query.offset + query.limit + 1);
    return { items: page.slice(0, query.limit), nextCursor: page.length > query.limit ? String(query.offset + query.limit) : null, genres: [{ id: "romance", name: "Romance" }, { id: "terror", name: "Terror & <Suspense>" }] };
  }
  public async get(bookId: string) { const found = this.books.find(item => item.bookId === bookId); if (!found) throw new ApiError(404, "CATALOG_BOOK_NOT_FOUND", "Livro não encontrado no catálogo."); return found; }
}

interface Captured { status: number; headers: Record<string, string>; body: Buffer; }
function call(controller: OpdsController, path: string, options: { auth?: string | null; proto?: string; ip?: string } = {}): Promise<Captured> {
  const headers: Record<string, string> = { host: "lumeo.test", "x-forwarded-proto": options.proto ?? "https" };
  if (options.auth !== null) headers.authorization = options.auth ?? `Basic ${Buffer.from(`leitor:${PASSWORD}`).toString("base64")}`;
  const request = { method: "GET", url: path, headers } as unknown as IncomingMessage;
  const captured: Captured = { status: 200, headers: {}, body: Buffer.alloc(0) };
  const response = {
    set statusCode(value: number) { captured.status = value; }, get statusCode() { return captured.status; },
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = String(value); },
    end(chunk?: string | Buffer) { if (chunk) captured.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); },
  } as unknown as ServerResponse;
  return controller.handle(request, response, new URL(path, "http://x").pathname, options.ip ?? "1.2.3.4").then(() => captured);
}

/** Tags open and close in order, and every attribute value is quoted: a well-formed document. */
function assertWellFormed(document: string): void {
  assert.match(document, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  const stack: string[] = [];
  for (const tag of document.replace(/^<\?xml[^>]*\?>/, "").matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g)) {
    if (tag[1]) assert.equal(stack.pop(), tag[2], `fecha ${tag[2]}`); else if (!tag[4]) stack.push(tag[2]!);
  }
  assert.deepEqual(stack, []);
  assert.doesNotMatch(document.replace(/<[^>]*>/g, ""), /[<>]|&(?!(amp|lt|gt|quot|apos);)/, "texto sem caracteres especiais soltos");
}

function setup(books = Array.from({ length: 65 }, (_, index) => book(index + 1)), perHour = 3) {
  const store = new MemoryStore(), catalog = new FakeCatalog(books);
  let fetches = 0;
  const fetcher = (async () => { fetches++; return new Response(new Uint8Array(await sharp({ create: { width: 600, height: 900, channels: 3, background: "#c33" } }).png().toBuffer()), { headers: { "content-type": "image/png" } }); }) as unknown as typeof fetch;
  const controller = new OpdsController(catalog, new OpdsAuth(store), new OpdsCoverService(fetcher), new OpdsDownloadService(store, perHour), { locale: "pt-BR", requireHttps: true });
  return { store, catalog, controller, fetches: () => fetches };
}

describe("catálogo OPDS: login", () => {
  it("sem credencial responde 401 com WWW-Authenticate Basic realm=\"Lumeo\", em toda rota (inclusive capa e download)", async () => {
    const { controller } = setup();
    for (const path of ["/api/opds", "/api/opds/generos/romance", "/api/opds/livros/livro-1/capa", "/api/opds/livros/livro-1/download", "/api/opds/opensearch.xml"]) {
      const result = await call(controller, path, { auth: null });
      assert.equal(result.status, 401, path);
      assert.match(result.headers["www-authenticate"]!, /^Basic realm="Lumeo"/);
    }
  });

  it("senha errada, usuário inexistente ou bloqueado: 401 e a falha fica registrada", async () => {
    const { controller, store } = setup();
    for (const auth of [`leitor:errada`, `ninguem:${PASSWORD}`, `parado:${PASSWORD}`]) assert.equal((await call(controller, "/api/opds", { auth: `Basic ${Buffer.from(auth).toString("base64")}` })).status, 401);
    assert.equal(store.attempts.length, 3);
    assert.equal((await call(controller, "/api/opds")).status, 200, "a senha certa entra");
  });

  it(`depois de ${OPDS_LOGIN_MAX_FAILURES} falhas o usuário é bloqueado por um tempo (contado no banco, não na memória)`, async () => {
    const { controller } = setup();
    for (let index = 0; index < OPDS_LOGIN_MAX_FAILURES; index++) await call(controller, "/api/opds", { auth: `Basic ${Buffer.from("leitor:errada").toString("base64")}` });
    const locked = await call(controller, "/api/opds");
    assert.equal(locked.status, 429); assert.ok(Number(locked.headers["retry-after"]) > 0);
    assert.equal((await call(controller, "/api/opds", { ip: "5.6.7.8" })).status, 200, "outro endereço continua entrando");
  });

  it("só HTTPS em produção", async () => {
    const { controller } = setup();
    assert.equal((await call(controller, "/api/opds", { proto: "http" })).status, 403);
  });
});

describe("catálogo OPDS: feeds", () => {
  it("raiz: um item de navegação por gênero, XML válido e com escape", async () => {
    const { controller } = setup();
    const result = await call(controller, "/api/opds");
    assert.equal(result.status, 200);
    assert.match(result.headers["content-type"]!, /^application\/atom\+xml;profile=opds-catalog;kind=navigation/);
    const body = result.body.toString();
    assertWellFormed(body);
    assert.match(body, /<title>Terror &amp; &lt;Suspense&gt;<\/title>/);
    assert.match(body, /<link rel="subsection" href="https:\/\/lumeo\.test\/api\/opds\/generos\/romance" type="application\/atom\+xml;profile=opds-catalog;kind=acquisition"\/>/);
    assert.match(body, /<link rel="search" href="https:\/\/lumeo\.test\/api\/opds\/opensearch\.xml"/);
  });

  it("gênero: 30 por página com first/previous/next, capa, miniatura, sinopse e download com o MIME certo", async () => {
    const { controller, catalog } = setup();
    const first = (await call(controller, "/api/opds/generos/romance")).body.toString();
    assertWellFormed(first);
    assert.equal((first.match(/<entry>/g) ?? []).length, OPDS_PAGE_SIZE);
    assert.match(first, /rel="next" href="https:\/\/lumeo\.test\/api\/opds\/generos\/romance\?page=2"/);
    assert.doesNotMatch(first, /rel="previous"/);
    assert.match(first, /<summary type="text">Sinopse 1<\/summary>/);
    assert.match(first, /rel="http:\/\/opds-spec\.org\/image" href="https:\/\/lumeo\.test\/api\/opds\/livros\/livro-1\/capa" type="image\/jpeg"/);
    assert.match(first, /rel="http:\/\/opds-spec\.org\/image\/thumbnail" href="https:\/\/lumeo\.test\/api\/opds\/livros\/livro-1\/capa\?tamanho=miniatura"/);
    assert.match(first, /rel="http:\/\/opds-spec\.org\/acquisition" href="https:\/\/lumeo\.test\/api\/opds\/livros\/livro-1\/download" type="application\/pdf" title="PDF · 1 KB" length="1001"/);
    assert.match(first, /href="https:\/\/lumeo\.test\/api\/opds\/livros\/livro-2\/download" type="application\/epub\+zip"/);
    const last = (await call(controller, "/api/opds/generos/romance?page=3")).body.toString();
    assert.equal((last.match(/<entry>/g) ?? []).length, 5);
    assert.match(last, /rel="previous" href="https:\/\/lumeo\.test\/api\/opds\/generos\/romance\?page=2"/);
    assert.doesNotMatch(last, /rel="next"/);
    assert.deepEqual(catalog.queries.map(query => [query.offset, query.limit, query.genreId, query.locale]), [[0, 30, "romance", "pt-BR"], [60, 30, "romance", "pt-BR"]]);
    assert.equal((await call(controller, "/api/opds/generos/inexistente")).status, 404);
  });

  it("título e sinopse com caracteres especiais continuam gerando XML válido", async () => {
    const { controller } = setup([book(1, { title: "Tom & Jerry <\"edição\"> 'especial'", description: "A > B & C < D\u0001", author: "O'Brien & Co" })]);
    const body = (await call(controller, "/api/opds/generos/romance")).body.toString();
    assertWellFormed(body);
    assert.match(body, /<title>Tom &amp; Jerry &lt;&quot;edição&quot;&gt; &apos;especial&apos;<\/title>/);
    assert.equal(xml("a\u0001b"), "ab", "caracteres proibidos no XML são removidos");
  });

  it("busca por título ou autor (OpenSearch)", async () => {
    const { controller } = setup();
    const description = (await call(controller, "/api/opds/opensearch.xml")).body.toString();
    assertWellFormed(description);
    assert.match(description, /template="https:\/\/lumeo\.test\/api\/opds\/busca\?q=\{searchTerms\}"/);
    const found = (await call(controller, "/api/opds/busca?q=autora%2012")).body.toString();
    assertWellFormed(found);
    assert.equal((found.match(/<entry>/g) ?? []).length, 1);
  });
});

describe("catálogo OPDS: capa e download", () => {
  it("capa em JPEG com 300 px (miniatura 150), feita uma vez por instância", async () => {
    const { controller, fetches } = setup();
    const cover = await call(controller, "/api/opds/livros/livro-1/capa");
    assert.equal(cover.status, 200); assert.equal(cover.headers["content-type"], "image/jpeg");
    assert.equal((await sharp(cover.body).metadata()).width, 300);
    assert.match(cover.headers["cache-control"]!, /^private/);
    await call(controller, "/api/opds/livros/livro-1/capa");
    assert.equal(fetches(), 1, "a segunda vez vem do cache");
    assert.equal((await sharp((await call(controller, "/api/opds/livros/livro-1/capa?tamanho=miniatura")).body).metadata()).width, 150);
  });

  it("download: 302 para o Drive com confirm=t, registrado, e limitado por hora", async () => {
    const { controller, store } = setup(undefined, 2);
    const first = await call(controller, "/api/opds/livros/livro-1/download");
    assert.equal(first.status, 302);
    assert.equal(first.headers.location, "https://drive.usercontent.google.com/download?id=arquivo1&export=download&confirm=t");
    assert.deepEqual(store.downloads.map(item => [item.userId, item.bookId]), [["u1", "livro-1"]]);
    await call(controller, "/api/opds/livros/livro-2/download");
    const limited = await call(controller, "/api/opds/livros/livro-3/download");
    assert.equal(limited.status, 429); assert.ok(Number(limited.headers["retry-after"]) > 0);
    assert.equal(store.downloads.length, 2);
    assert.equal(opdsDownloadUrl({ driveFileId: "abc", resourceKey: "0-k" }), "https://drive.usercontent.google.com/download?id=abc&export=download&confirm=t&resourcekey=0-k");
  });
});

describe("catálogo OPDS no BFF", () => {
  it("/api/opds tem o próprio login (não pede o token do app) e as outras rotas não mudam", async () => {
    const handler = ServerApp.create({ ...Config.fromEnvironment({ NODE_ENV: "development" } as NodeJS.ProcessEnv), localAuthMode: true });
    const run = async (path: string) => {
      const captured: Captured = { status: 200, headers: {}, body: Buffer.alloc(0) };
      const response = { set statusCode(value: number) { captured.status = value; }, get statusCode() { return captured.status; }, setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = String(value); }, getHeader: () => undefined, end(chunk?: string) { if (chunk) captured.body = Buffer.from(chunk); } } as unknown as ServerResponse;
      await handler({ method: "GET", url: path, headers: {}, socket: { remoteAddress: "127.0.0.1" } } as unknown as IncomingMessage, response);
      return captured;
    };
    const opds = await run("/api/opds");
    assert.equal(opds.status, 503, "sem Supabase o catálogo OPDS fica indisponível, sem cair no login do app");
    assert.doesNotMatch(opds.body.toString(), /AUTH_REQUIRED/);
    const me = await run("/api/me");
    assert.equal(me.status, 401); assert.match(me.body.toString(), /AUTH_REQUIRED/);
  });

  it("desafia com Basic antes de inicializar o Drive e nunca cai no login Bearer", async () => {
    const config = Config.fromEnvironment({
      NODE_ENV: "production", APP_BASE_URL: "https://lumeo.test",
      SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "publishable-test", SUPABASE_SECRET_KEY: "secret-test",
    } as NodeJS.ProcessEnv);
    const handler = ServerApp.create(config);
    const captured: Captured = { status: 200, headers: {}, body: Buffer.alloc(0) };
    const response = { set statusCode(value: number) { captured.status = value; }, get statusCode() { return captured.status; }, setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = String(value); }, getHeader: () => undefined, end(chunk?: string) { if (chunk) captured.body = Buffer.from(chunk); } } as unknown as ServerResponse;
    await handler({ method: "GET", url: "/api/opds", headers: { host: "lumeo.test", "x-forwarded-proto": "https" }, socket: { remoteAddress: "127.0.0.1" } } as unknown as IncomingMessage, response);
    assert.equal(captured.status, 401);
    assert.match(captured.headers["www-authenticate"]!, /^Basic realm="Lumeo"/);
    assert.doesNotMatch(captured.body.toString(), /AUTH_REQUIRED/);
  });
});

describe("fontes de livros do catálogo", () => {
  it("o piloto OPDS aponta para Autoajuda sem remover as fontes normais do aplicativo", () => {
    const config = Config.fromEnvironment({ NODE_ENV: "production" } as NodeJS.ProcessEnv);
    assert.ok(config.catalogDiscoveryRoots?.length, "as raízes existentes do catálogo principal continuam configuradas");
    assert.ok(config.catalogSources.length, "a fonte legada do aplicativo continua configurada");
    assert.equal(config.opdsAutoajudaFolderId, "1Pqu3DcMJT8wTwC7pFX7e20Z9fPUDJBoZ");
    assert.deepEqual(opdsAutoajudaSource(config), {
      sourceId: "opds-autoajuda", locale: "pt-BR", folderId: "1Pqu3DcMJT8wTwC7pFX7e20Z9fPUDJBoZ",
      mode: "structured", enabled: true, priority: 1, genre: "Autoajuda",
    });
  });

  it("raízes e fontes continuam possíveis quando configuradas explicitamente", () => {
    const config = Config.fromEnvironment({ NODE_ENV: "production", GOOGLE_CATALOG_DISCOVERY_ROOTS: "1bMwUwTOKGrcZfKyEgL-yyS69Xk1CxFYe", GOOGLE_CATALOG_SOURCES_JSON: JSON.stringify([{ sourceId: "minha-fonte", locale: "pt-BR", folderId: "1AbCdEfGhIjKlMnOp", mode: "structured", enabled: true, priority: 1 }]) } as NodeJS.ProcessEnv);
    assert.deepEqual(config.catalogDiscoveryRoots, ["1bMwUwTOKGrcZfKyEgL-yyS69Xk1CxFYe"]);
    assert.deepEqual(config.catalogSources.map(source => source.sourceId), ["minha-fonte"]);
  });
});

describe("catálogo OPDS sobre uma fonte única (piloto Autoajuda)", () => {
  it("a raiz lista o gênero da fonte mesmo quando a fonte não devolve gêneros (o Kindle via \"Nenhum item\")", async () => {
    const source = opdsAutoajudaSource(Config.fromEnvironment({ NODE_ENV: "production" } as NodeJS.ProcessEnv));
    const books = Array.from({ length: 40 }, (_, index) => book(index + 1, { genreId: "autoajuda", genreName: "Autoajuda" }));
    // Como o StructuredDriveCatalogProvider real: itens e próxima página, sem a lista de gêneros.
    const provider = {
      list: async (query: CatalogQuery): Promise<CatalogPage> => {
        const filtered = books.filter(item => !query.genreId || item.genreId === query.genreId), page = filtered.slice(query.offset, query.offset + query.limit + 1);
        return { items: page.slice(0, query.limit), nextCursor: page.length > query.limit ? String(query.offset + query.limit) : null };
      },
      get: async (bookId: string) => books.find(item => item.bookId === bookId) ?? null,
    };
    const store = new MemoryStore();
    const controller = new OpdsController(opdsSourceCatalog(provider, source), new OpdsAuth(store), new OpdsCoverService(), new OpdsDownloadService(store, 30), { locale: "pt-BR", requireHttps: true });
    const root = (await call(controller, "/api/opds")).body.toString();
    assertWellFormed(root);
    assert.equal((root.match(/<entry>/g) ?? []).length, 1);
    assert.match(root, /<title>Autoajuda<\/title>/);
    assert.match(root, /href="https:\/\/lumeo\.test\/api\/opds\/generos\/autoajuda"/);
    const shelf = (await call(controller, "/api/opds/generos/autoajuda")).body.toString();
    assertWellFormed(shelf);
    assert.equal((shelf.match(/<entry>/g) ?? []).length, OPDS_PAGE_SIZE);
    assert.match(shelf, /rel="next"/);
    assert.equal((await call(controller, "/api/opds/livros/inexistente/download")).status, 404);
  });
});

/** What KOReader shows as "Book description": the entry's content, XML-decoded once by its parser,
 *  then util.htmlToPlainText (<br/> as line breaks, other tags dropped, entities decoded). */
function koreaderDescription(entry: string): string {
  const raw = /<content type="html">([\s\S]*?)<\/content>/.exec(entry)?.[1] ?? "";
  const decode = (text: string) => text.replace(/&(lt|gt|quot|apos|#39|amp);/g, (_, name: string) => ({ lt: "<", gt: ">", quot: "\"", apos: "'", "#39": "'", amp: "&" })[name]!);
  return decode(decode(raw).replace(/\s*<\s*br\s*\/?>\s*/g, "\n").replace(/<[^>]*>/g, "")).trim();
}

describe("catálogo OPDS: página do livro no KOReader", () => {
  it("cada livro traz capa, miniatura, autor, idioma, formato, sinopse e download", async () => {
    const { controller } = setup([book(2, { fileSize: 1_288_490, collection: "Hábitos", volume: "2" })]);
    const feed = (await call(controller, "/api/opds/generos/romance")).body.toString();
    assertWellFormed(feed);
    const entry = /<entry>[\s\S]*?<\/entry>/.exec(feed)![0];
    assert.match(entry, /<author><name>Autora 2<\/name><\/author>/);
    assert.match(entry, /<dc:language>pt-BR<\/dc:language>/);
    assert.match(entry, /<dc:format>application\/epub\+zip<\/dc:format>/);
    assert.match(entry, /<summary type="text">Sinopse 2<\/summary>/);
    assert.match(entry, /rel="http:\/\/opds-spec\.org\/image" href="[^"]+\/livros\/livro-2\/capa" type="image\/jpeg"/);
    assert.match(entry, /rel="http:\/\/opds-spec\.org\/image\/thumbnail" href="[^"]+\/livros\/livro-2\/capa\?tamanho=miniatura" type="image\/jpeg"/);
    assert.match(entry, /rel="http:\/\/opds-spec\.org\/acquisition" href="[^"]+\/livros\/livro-2\/download" type="application\/epub\+zip" title="EPUB · 1,2 MB" length="1288490"/);
    assert.equal(koreaderDescription(entry), [
      "Título: Livro 2", "Autor: Autora 2", "Gênero: Romance", "Coleção: Hábitos", "Volume: 2", "Idioma: Português (Brasil)", "Formato: EPUB · 1,2 MB", "Kindle: versão Kindle em preparação",
      "", "Sinopse", "Sinopse 2",
    ].join("\n"));
  });

  it("caracteres especiais e quebras de linha da sinopse chegam certos ao KOReader; sem sinopse, um aviso", async () => {
    const { controller } = setup([book(1, { title: "Tom & Jerry <\"edição\">", author: "O'Brien & Co", description: "Linha 1 & 2\nLinha <3>" }), book(3, { description: null })]);
    const feed = (await call(controller, "/api/opds/generos/romance")).body.toString();
    assertWellFormed(feed);
    const [first, second] = [...feed.matchAll(/<entry>[\s\S]*?<\/entry>/g)].map(match => match[0]);
    const text = koreaderDescription(first!);
    assert.match(text, /^Título: Tom & Jerry <"edição">\nAutor: O'Brien & Co\n/);
    assert.match(text, /\nSinopse\nLinha 1 & 2\nLinha <3>$/);
    assert.match(koreaderDescription(second!), /\nSinopse\nSinopse não disponível\.$/);
  });

  it("formato e idioma legíveis", () => {
    assert.equal(opdsFormatLabel({ format: "pdf", fileSize: 121_919_782 }), "PDF · 116,3 MB");
    assert.equal(opdsFormatLabel({ format: "epub", fileSize: 300_000 }), "EPUB · 293 KB");
    assert.equal(opdsFormatLabel({ format: "epub", fileSize: null }), "EPUB");
    assert.equal(opdsLanguageName("pt-BR"), "Português (Brasil)");
    assert.equal(opdsLanguageName("en"), "Inglês");
  });
});

class FakeEditions implements KindleEditionReader {
  public broken = false;
  public constructor(public readonly rows: KindleEdition[] = []) {}
  public async editionsFor(bookIds: readonly string[]) {
    if (this.broken) throw new Error("relation \"kindle_editions\" does not exist");
    return new Map(this.rows.filter(row => bookIds.includes(row.bookId)).map(row => [row.bookId, row]));
  }
}

/** The converted file's id in the "Lumeo Kindle AZW3" Drive folder (never the EPUB's). */
const azw3Id = (bookId: string) => `azw3Drive_${bookId}`;
const ready = (bookId: string, size = 1_990_000): KindleEdition => ({ bookId, status: "ready", format: "azw3", driveFileId: azw3Id(bookId), size });

function setupKindle(rows: KindleEdition[], books = Array.from({ length: 65 }, (_, index) => book(index + 1)), perHour = 3) {
  const store = new MemoryStore(), catalog = new FakeCatalog(books), editions = new FakeEditions(rows);
  const fetcher = (async () => new Response(new Uint8Array(await sharp({ create: { width: 1400, height: 2100, channels: 3, background: "#36c" } }).png().toBuffer()), { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
  const controller = new OpdsController(catalog, new OpdsAuth(store), new OpdsCoverService(fetcher), new OpdsDownloadService(store, perHour), { locale: "pt-BR", requireHttps: true }, editions);
  return { store, catalog, editions, controller };
}

describe("edição Kindle (AZW3) no catálogo", () => {
  it("o Kindle só recebe AZW3 convertido de verdade; senão em preparação, falhou ou indisponível", () => {
    const epub = book(2), pdf = book(1);
    assert.deepEqual(kindleOffer(epub, undefined), { status: "pending", format: null, size: null });
    assert.equal(kindleOffer(epub, { ...ready("livro-2"), status: "processing" }).status, "processing");
    assert.equal(kindleOffer(epub, { bookId: "livro-2", status: "failed", format: null, driveFileId: null, size: null }).status, "failed");
    assert.equal(kindleOffer(epub, { ...ready("livro-2"), driveFileId: null }).status, "pending", "pronta sem arquivo não conta como pronta");
    assert.deepEqual(kindleOffer(epub, ready("livro-2")), { status: "ready", format: "azw3", size: 1_990_000, edition: ready("livro-2") });
    assert.deepEqual(kindleOffer(pdf, undefined), { status: "unavailable", format: null, size: null }, "PDF do catálogo não vai como AZW3");
    assert.equal(kindleOffer(pdf, ready("livro-1")).status, "ready", "se um dia houver AZW3 para ele, vale o AZW3");
  });

  it("feed OPDS: com AZW3 pronto ganha um 2º link de download (o EPUB continua primeiro); sem, nada muda além da linha Kindle", async () => {
    const { controller } = setupKindle([ready("livro-2")]);
    const feed = (await call(controller, "/api/opds/generos/romance")).body.toString();
    assertWellFormed(feed);
    const entries = [...feed.matchAll(/<entry>[\s\S]*?<\/entry>/g)].map(match => match[0]);
    const links = [...entries[1]!.matchAll(/<link rel="http:\/\/opds-spec\.org\/acquisition"[^>]*>/g)].map(match => match[0]);
    assert.equal(links.length, 2);
    assert.match(links[0]!, /livros\/livro-2\/download" type="application\/epub\+zip"/);
    assert.match(links[1]!, /livros\/livro-2\/download\?formato=kindle" type="application\/vnd\.amazon\.mobi8-ebook" title="Kindle · AZW3 · 1,9 MB" length="1990000"/);
    assert.match(koreaderDescription(entries[1]!), /\nKindle: AZW3 · 1,9 MB\n/);
    assert.equal([...entries[3]!.matchAll(/opds-spec\.org\/acquisition/g)].length, 1, "EPUB sem edição: só o EPUB");
    assert.match(koreaderDescription(entries[3]!), /\nKindle: versão Kindle em preparação\n/);
    assert.equal([...entries[0]!.matchAll(/opds-spec\.org\/acquisition/g)].length, 1, "PDF do catálogo: só o PDF");
    assert.match(koreaderDescription(entries[0]!), /\nKindle: versão Kindle indisponível\n/);
  });

  it("download?formato=kindle: AZW3 pronto → 302 para o arquivo AZW3 no Drive (não o EPUB), contado no limite", async () => {
    const { controller, store } = setupKindle([ready("livro-2")]);
    const result = await call(controller, "/api/opds/livros/livro-2/download?formato=kindle");
    assert.equal(result.status, 302);
    assert.equal(result.headers.location, `https://drive.usercontent.google.com/download?id=${azw3Id("livro-2")}&export=download&confirm=t`);
    assert.equal(result.headers.location, kindleDownloadUrl(ready("livro-2")));
    assert.ok(!String(result.headers.location).includes(book(2).driveFileId), "nunca o EPUB original");
    assert.equal(result.headers["cache-control"], "no-store");
    assert.deepEqual(store.downloads.map(item => item.bookId), ["livro-2"]);
  });

  it("download?formato=kindle continua exigindo login (sem senha → 401, nada contado)", async () => {
    const { controller, store } = setupKindle([ready("livro-2")]);
    const anonymous = await call(controller, "/api/opds/livros/livro-2/download?formato=kindle", { auth: null });
    assert.equal(anonymous.status, 401); assert.equal(anonymous.headers.location, undefined);
    assert.equal(store.downloads.length, 0);
  });

  it("download?formato=kindle: sem AZW3 pronto (em preparação, falhou ou PDF) → 409 e nada é contado", async () => {
    const { controller, store } = setupKindle([{ bookId: "livro-4", status: "failed", format: null, driveFileId: null, size: null }]);
    const pdf = await call(controller, "/api/opds/livros/livro-1/download?formato=kindle");
    assert.equal(pdf.status, 409); assert.match(pdf.body.toString(), /não tem versão Kindle/);
    const pending = await call(controller, "/api/opds/livros/livro-2/download?formato=kindle");
    assert.equal(pending.status, 409); assert.match(pending.body.toString(), /sendo preparada/);
    const failed = await call(controller, "/api/opds/livros/livro-4/download?formato=kindle");
    assert.equal(failed.status, 409); assert.match(failed.body.toString(), /não tem versão Kindle/);
    assert.equal(store.downloads.length, 0);
  });

  it("download sem formato continua igual (arquivo original no Drive); formato desconhecido → 400", async () => {
    const { controller } = setupKindle([ready("livro-2")]);
    const original = await call(controller, "/api/opds/livros/livro-2/download");
    assert.equal(original.status, 302); assert.equal(original.headers.location, opdsDownloadUrl(book(2)));
    assert.equal((await call(controller, "/api/opds/livros/livro-2/download?formato=mobi")).status, 400);
  });

  it("limite por hora vale para a edição Kindle e não entrega o endereço", async () => {
    const { controller, store } = setupKindle([ready("livro-2")], undefined, 1);
    assert.equal((await call(controller, "/api/opds/livros/livro-2/download?formato=kindle")).status, 302);
    const limited = await call(controller, "/api/opds/livros/livro-2/download?formato=kindle");
    assert.equal(limited.status, 429); assert.equal(limited.headers.location, undefined);
    assert.equal(store.downloads.length, 1);
  });

  it("tabela de edições fora do ar na hora do download → 409 (sem endereço) e nada é contado", async () => {
    const { controller, editions, store } = setupKindle([ready("livro-2")]);
    editions.broken = true;
    const result = await call(controller, "/api/opds/livros/livro-2/download?formato=kindle");
    assert.equal(result.status, 409); assert.equal(result.headers.location, undefined);
    assert.equal(store.downloads.length, 0);
  });

  it("tabela de edições indisponível (migração não aplicada): o catálogo continua respondendo, sem AZW3", async () => {
    const { controller, editions } = setupKindle([ready("livro-2")]);
    editions.broken = true;
    const feed = await call(controller, "/api/opds/generos/romance");
    assert.equal(feed.status, 200); assertWellFormed(feed.body.toString());
    assert.doesNotMatch(feed.body.toString(), /formato=kindle/);
    assert.equal((await call(controller, "/api/opds/kindle/livros?genero=romance")).status, 200);
    assert.equal((await call(controller, "/api/opds/livros/livro-2/download?formato=kindle")).status, 409);
  });

  it("capa grande (600 px) para a tela do livro na extensão do Kindle", async () => {
    const { controller } = setupKindle([]);
    const result = await call(controller, "/api/opds/livros/livro-2/capa?tamanho=grande");
    assert.equal(result.status, 200); assert.equal(result.headers["content-type"], "image/jpeg");
    assert.equal((await sharp(result.body).metadata()).width, 600);
  });
});

describe("JSON da extensão do Kindle (/api/opds/kindle)", () => {
  it("pede o mesmo login do catálogo", async () => {
    const { controller } = setupKindle([]);
    for (const path of ["/api/opds/kindle/generos", "/api/opds/kindle/livros", "/api/opds/kindle/livros/livro-2"]) assert.equal((await call(controller, path, { auth: null })).status, 401, path);
  });

  it("gêneros e páginas de 30 livros, com capa grande, sinopse e o arquivo que vai para a biblioteca", async () => {
    const { controller } = setupKindle([ready("livro-32")]);
    const genres = await call(controller, "/api/opds/kindle/generos");
    assert.equal(genres.headers["content-type"], "application/json; charset=utf-8");
    assert.deepEqual(JSON.parse(genres.body.toString()), { catalog: "Lumeo", genres: [{ id: "romance", name: "Romance" }, { id: "terror", name: "Terror & <Suspense>" }] });
    const page = JSON.parse((await call(controller, "/api/opds/kindle/livros?genero=romance&page=2")).body.toString());
    assert.equal(page.page, 2); assert.equal(page.hasNext, true); assert.equal(page.books.length, 30);
    const azw3 = page.books.find((item: { id: string }) => item.id === "livro-32");
    assert.deepEqual(azw3, {
      id: "livro-32", title: "Livro 32", author: "Autora 32", synopsis: "Sinopse 32", language: "pt-BR", languageName: "Português (Brasil)", genre: "Romance", genreId: "romance", collection: null, volume: null,
      cover: "https://lumeo.test/api/opds/livros/livro-32/capa?tamanho=grande", thumbnail: "https://lumeo.test/api/opds/livros/livro-32/capa",
      original: { format: "epub", size: 1032 },
      kindle: { status: "ready", format: "azw3", size: 1_990_000, url: "https://lumeo.test/api/opds/livros/livro-32/download?formato=kindle", fileName: "Autora 32 - Livro 32.azw3" },
    });
    const pending = page.books.find((item: { id: string }) => item.id === "livro-34");
    assert.deepEqual(pending.kindle, { status: "pending", format: null, size: null, url: null, fileName: null });
    const pdf = page.books.find((item: { id: string }) => item.id === "livro-31");
    assert.deepEqual(pdf.kindle, { status: "unavailable", format: null, size: null, url: null, fileName: null });
    const last = JSON.parse((await call(controller, "/api/opds/kindle/livros?genero=romance&page=3")).body.toString());
    assert.equal(last.hasNext, false); assert.equal(last.books.length, 5);
  });

  it("busca, um livro, sinopse ausente e livro inexistente", async () => {
    const { controller } = setupKindle([], [book(1), book(2, { title: "Hábitos Atômicos", description: "  " })]);
    const found = JSON.parse((await call(controller, "/api/opds/kindle/livros?q=h%C3%A1bitos")).body.toString());
    assert.deepEqual(found.books.map((item: { id: string }) => item.id), ["livro-2"]);
    const one = JSON.parse((await call(controller, "/api/opds/kindle/livros/livro-2")).body.toString());
    assert.equal(one.book.title, "Hábitos Atômicos"); assert.equal(one.book.synopsis, null);
    assert.equal((await call(controller, "/api/opds/kindle/livros/nao-existe")).status, 404);
    assert.equal((await call(controller, "/api/opds/kindle/qualquer")).status, 404);
  });

  it("nome do arquivo no Kindle: sem caracteres proibidos no FAT, sem 'Autor não informado', no máximo 200 bytes", () => {
    assert.equal(kindleFileName({ author: "O'Brien: \"Co\"", title: "Sim/Não? <2>", bookId: "x" }, "azw3"), "O'Brien Co - Sim Não 2.azw3");
    assert.equal(kindleFileName({ author: "Autor não informado", title: "Só o título...", bookId: "x" }, "pdf"), "Só o título.pdf");
    assert.equal(kindleFileName({ author: "", title: "", bookId: "bk_1" }, "azw3"), "bk_1.azw3");
    const long = kindleFileName({ author: "Ação", title: "ç".repeat(300), bookId: "x" }, "azw3");
    assert.ok(Buffer.byteLength(long) <= 205, String(Buffer.byteLength(long)));
    assert.match(long, /^Ação - ç+\.azw3$/);
  });

  it("linhas do banco inválidas são ignoradas", () => {
    assert.equal(SupabaseKindleEditions.edition({ book_id: "a", status: "talvez" }), null);
    assert.equal(SupabaseKindleEditions.edition({ status: "ready" }), null);
    assert.deepEqual(SupabaseKindleEditions.edition({ book_id: "a", status: "ready", format: "pdf", drive_file_id: "", size_bytes: -1 }), { bookId: "a", status: "ready", format: null, driveFileId: null, size: null });
    assert.deepEqual(SupabaseKindleEditions.edition({ book_id: "a", status: "ready", format: "azw3", drive_file_id: "1AbC-dEf_ghIJkl", size_bytes: "1990000" }), { bookId: "a", status: "ready", format: "azw3", driveFileId: "1AbC-dEf_ghIJkl", size: 1_990_000 });
    assert.equal(SupabaseKindleEditions.edition({ book_id: "a", status: "ready", format: "azw3", drive_file_id: "x/../y?z=1", size_bytes: 10 })?.driveFileId, null, "id estranho não vira endereço");
    assert.throws(() => kindleDownloadUrl({ driveFileId: null }), /NOT_READY/);
  });
});
