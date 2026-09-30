import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zipSync } from "fflate";
import sharp from "sharp";
import { ComicCoverThumbnailService } from "../src/collections/ComicCoverThumbnailService.js";
import { DriveCollectionService } from "../src/collections/DriveCollectionService.js";
import { DriveFolderBrowser } from "../src/collections/DriveFolderBrowser.js";

const ROOT = "1wXs64lZ0nOBAAWwGutDHfjO-TnfYO6Ee";
const FOLDER = "application/vnd.google-apps.folder";
const collections = [{ id: "marvel-hqs", name: "HQs da Marvel", rootFolderId: ROOT, contentType: "comic" as const }];

interface FakeNode { id: string; name: string; mimeType: string; parent: string | null; size?: string }

/** Same fake Drive listing shape already proven in DriveCollections.test.ts - the point of
 *  this suite is to prove the cover service rides on the exact same validated listing, not
 *  to re-invent Drive. */
function fakeDrive(nodes: readonly FakeNode[]) {
  const request = async (url: URL): Promise<Response> => {
    const query = url.searchParams.get("q");
    if (query) {
      const parent = /'([^']+)' in parents/.exec(query)![1]!;
      const files = nodes.filter(node => node.parent === parent)
        .map(node => ({ id: node.id, name: node.name, mimeType: node.mimeType, size: node.size, modifiedTime: "2026-01-01T00:00:00Z" }));
      return new Response(JSON.stringify({ files }), { status: 200 });
    }
    const id = decodeURIComponent(url.pathname.split("/").pop()!);
    const node = nodes.find(item => item.id === id);
    if (!node) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ id: node.id, name: node.name, mimeType: node.mimeType, parents: node.parent ? [node.parent] : [] }), { status: 200 });
  };
  return { request };
}

/** A real, sharp-decodable JPEG - not a fake magic-byte stand-in - because this suite
 *  exercises the real resize() through the real `sharp`, unlike the client-side generator
 *  tests (which fake out CoverService entirely). */
async function realJpegPage(color: { r: number; g: number; b: number }): Promise<Uint8Array> {
  return sharp({ create: { width: 40, height: 60, channels: 3, background: color } }).jpeg().toBuffer();
}

function fakeDriveMedia(files: Record<string, Uint8Array>) {
  const calls: Array<{ fileId: string; range?: string }> = [];
  const mediaRange = async (fileId: string, range?: string): Promise<Response> => {
    calls.push({ fileId, range });
    const bytes = files[fileId];
    if (!bytes) return new Response(null, { status: 404 });
    if (!range) return new Response(new Uint8Array(bytes), { status: 200 });
    const [startRaw, endRaw] = range.replace("bytes=", "").split("-");
    const start = Number(startRaw), end = Number(endRaw);
    return new Response(new Uint8Array(bytes.subarray(Math.max(0, start), Math.min(bytes.length, end + 1))), { status: 206 });
  };
  return { mediaRange, calls };
}

type FakeArchiveEntry = { path: string; file: { name: string; size: number; extract(): Promise<File> } };
function fakeOpenArchive(entries: readonly FakeArchiveEntry[], options: { encrypted?: boolean } = {}) {
  const closed: boolean[] = [];
  const open = async () => ({
    hasEncryptedData: async () => Boolean(options.encrypted),
    getFilesArray: async () => entries,
    close: async () => { closed.push(true); },
  });
  return { open, closed };
}

const setup = (nodes: readonly FakeNode[], driveMedia: ReturnType<typeof fakeDriveMedia>, openArchive?: ReturnType<typeof fakeOpenArchive>["open"]) => {
  const drive = fakeDrive(nodes);
  const collectionsService = new DriveCollectionService(collections, new DriveFolderBrowser(drive.request));
  return new ComicCoverThumbnailService(collectionsService, driveMedia, openArchive);
};

describe("ComicCoverThumbnailService: segurança - reusa a mesma validação de coleção/pasta/fileId", () => {
  const nodes: FakeNode[] = [
    { id: ROOT, name: "HQs da Marvel", mimeType: FOLDER, parent: null },
    { id: "sw", name: "STAR WARS", mimeType: FOLDER, parent: ROOT },
    { id: "f-cbr", name: "001.cbr", mimeType: "application/x-cbr", parent: "sw", size: "1000" },
  ];

  it("uma coleção inexistente não gera nada", async () => {
    const media = fakeDriveMedia({});
    const service = setup(nodes, media);
    await assert.rejects(() => service.thumbnail("nao-existe", "f-cbr", [ROOT, "sw", "f-cbr"]));
    assert.deepEqual(media.calls, [], "nem o Drive deveria ter sido tocado");
  });

  it("um path cujo último passo não é o fileId pedido é recusado, sem tocar o Drive", async () => {
    const media = fakeDriveMedia({});
    const service = setup(nodes, media);
    const result = await service.thumbnail("marvel-hqs", "f-cbr", [ROOT, "sw", "outro-arquivo"]);
    assert.equal(result, null);
    assert.deepEqual(media.calls, []);
  });

  it("um fileId que não pertence à pasta indicada é recusado", async () => {
    const media = fakeDriveMedia({});
    const service = setup(nodes, media);
    // "f-cbr" exists, but not directly under ROOT - only under ROOT/sw.
    const result = await service.thumbnail("marvel-hqs", "f-cbr", [ROOT, "f-cbr"]);
    assert.equal(result, null);
  });

  it("uma pasta fora das raízes autorizadas da coleção é recusada (a mesma checagem de open())", async () => {
    const media = fakeDriveMedia({});
    const service = setup(nodes, media);
    await assert.rejects(() => service.thumbnail("marvel-hqs", "f-cbr", ["raiz-estranha", "f-cbr"]));
  });

  it("um arquivo que não é CBR/CBZ (ex.: PDF) nunca chega a gerar nada", async () => {
    const withPdf = [...nodes, { id: "f-pdf", name: "Leia-me.pdf", mimeType: "application/pdf", parent: "sw" }];
    const media = fakeDriveMedia({});
    const service = setup(withPdf, media);
    const result = await service.thumbnail("marvel-hqs", "f-pdf", [ROOT, "sw", "f-pdf"]);
    assert.equal(result, null);
    assert.deepEqual(media.calls, [], "um formato fora de escopo nunca deveria pedir bytes ao Drive");
  });

  it("nenhuma URL arbitrária é aceita - só fileId + o caminho já validado da coleção", () => {
    // The public surface is exactly thumbnail(collectionId, fileId, path) - there is no
    // parameter anywhere that could carry an arbitrary URL.
    assert.equal(ComicCoverThumbnailService.prototype.thumbnail.length, 3);
  });
});

describe("ComicCoverThumbnailService: CBZ via Range, nunca o arquivo inteiro", () => {
  const nodes: FakeNode[] = [
    { id: ROOT, name: "HQs da Marvel", mimeType: FOLDER, parent: null },
    { id: "f-cbz", name: "001.cbz", mimeType: "application/x-cbz", parent: ROOT },
  ];

  it("gera a capa lendo só faixas de bytes, devolve JPEG pequeno e os metadados do ComicInfo.xml", async () => {
    const page = await realJpegPage({ r: 200, g: 40, b: 40 });
    const zip = zipSync({
      "ComicInfo.xml": new TextEncoder().encode("<ComicInfo><Title>Guerras Secretas</Title><Number>1</Number><Writer>Jim Shooter</Writer></ComicInfo>"),
      "001.jpg": page,
    });
    const withSize = nodes.map(node => node.id === "f-cbz" ? { ...node, size: String(zip.length) } : node);
    const media = fakeDriveMedia({ "f-cbz": zip });
    const service = setup(withSize, media);
    const result = await service.thumbnail("marvel-hqs", "f-cbz", [ROOT, "f-cbz"]);
    assert.ok(result, "deveria ter gerado uma capa");
    assert.equal(result!.contentType, "image/jpeg");
    assert.ok(result!.image.length < zip.length, "a miniatura devolvida deve ser bem menor que o arquivo original");
    assert.equal(result!.metadata.title, "Guerras Secretas");
    assert.equal(result!.metadata.number, "1");
    assert.equal(result!.metadata.writer, "Jim Shooter");
    assert.equal(result!.metadata.summary, null, "campo ausente no ComicInfo.xml fica null, nunca inventado");
    // extractFirstCbzPage/extractCbzCoverAndInfo's own suite (CbzFirstPageExtractor.test.ts)
    // already proves the byte-range math stays a small fraction of a real-sized archive;
    // what this test adds is that the BFF path reaches the Drive client exclusively through
    // Range requests, never a plain whole-file GET.
    assert.ok(media.calls.every(call => call.range), "cada leitura ao Drive deveria ter pedido uma faixa, nunca o arquivo completo");
  });

  it("sem ComicInfo.xml no arquivo, os metadados voltam todos null - nunca inventados", async () => {
    const page = await realJpegPage({ r: 10, g: 10, b: 200 });
    const zip = zipSync({ "001.jpg": page });
    const withSize = nodes.map(node => node.id === "f-cbz" ? { ...node, size: String(zip.length) } : node);
    const media = fakeDriveMedia({ "f-cbz": zip });
    const service = setup(withSize, media);
    const result = await service.thumbnail("marvel-hqs", "f-cbz", [ROOT, "f-cbz"]);
    assert.ok(result);
    assert.deepEqual(result!.metadata, { title: null, series: null, number: null, year: null, summary: null, writer: null, publisher: null, genre: null });
  });

  it("uma falha de geração nunca lança - devolve null, e o chamador decide o 404", async () => {
    const withSize = nodes.map(node => node.id === "f-cbz" ? { ...node, size: "5" } : node);
    const media = fakeDriveMedia({ "f-cbz": new Uint8Array([1, 2, 3, 4, 5]) });
    const service = setup(withSize, media);
    await assert.doesNotReject(async () => {
      const result = await service.thumbnail("marvel-hqs", "f-cbz", [ROOT, "f-cbz"]);
      assert.equal(result, null);
    });
  });
});

describe("ComicCoverThumbnailService: CBR via arquivo completo, reutilizando o engine do libarchive.js", () => {
  const nodes: FakeNode[] = [
    { id: ROOT, name: "HQs da Marvel", mimeType: FOLDER, parent: null },
    { id: "f-cbr", name: "001.cbr", mimeType: "application/x-cbr", parent: ROOT, size: "999" },
  ];

  it("baixa o arquivo inteiro uma vez, extrai a primeira página em ordenação natural e descarta o archive", async () => {
    // Three different colors, so the test can tell *which* page actually became the cover -
    // not just that some page did.
    const red = await realJpegPage({ r: 255, g: 0, b: 0 });
    const green = await realJpegPage({ r: 0, g: 255, b: 0 });
    const blue = await realJpegPage({ r: 0, g: 0, b: 255 });
    const file = (name: string, bytes: Uint8Array) => ({ name, size: bytes.length, extract: async () => new File([new Uint8Array(bytes)], name, { type: "image/jpeg" }) });
    // Deliberately out of natural order, like a real RAR's own directory listing - "page 2"
    // sits before "page 10" before "page 1" in raw archive order.
    const entries = [
      { path: "", file: file("pg 02.jpg", green) },
      { path: "", file: file("pg 10.jpg", blue) },
      { path: "", file: file("pg 01.jpg", red) },
      { path: "", file: { name: "ComicInfo.xml", size: 40, extract: async () => new File([new TextEncoder().encode("<ComicInfo><Series>X-Men</Series><Year>1991</Year></ComicInfo>")], "ComicInfo.xml") } },
    ];
    const archive = fakeOpenArchive(entries);
    const media = fakeDriveMedia({ "f-cbr": new Uint8Array([0x52, 0x61, 0x72, 0x21]) });
    const service = setup(nodes, media, archive.open);
    const result = await service.thumbnail("marvel-hqs", "f-cbr", [ROOT, "f-cbr"]);
    assert.ok(result);
    assert.equal(result!.contentType, "image/jpeg");
    assert.equal(result!.metadata.series, "X-Men");
    assert.equal(result!.metadata.year, "1991");
    assert.deepEqual(archive.closed, [true], "o archive temporário deve ser fechado depois de extrair");
    assert.deepEqual(media.calls.map(call => call.range), [undefined], "CBR pede o arquivo inteiro de uma vez, não faixas");
    // The cover must be page 01 (red) - natural order, not raw archive listing order (which
    // would have picked "pg 02" first) and not lexicographic order either.
    const pixel = await sharp(result!.image).raw().toBuffer();
    assert.ok(pixel[0]! > 200 && pixel[1]! < 60 && pixel[2]! < 60, `esperava vermelho (página 01), leu rgb(${pixel[0]},${pixel[1]},${pixel[2]})`);
  });

  it("um CBR com dados criptografados não gera capa, nunca lança", async () => {
    const archive = fakeOpenArchive([], { encrypted: true });
    const media = fakeDriveMedia({ "f-cbr": new Uint8Array([0x52, 0x61, 0x72, 0x21]) });
    const service = setup(nodes, media, archive.open);
    const result = await service.thumbnail("marvel-hqs", "f-cbr", [ROOT, "f-cbr"]);
    assert.equal(result, null);
    assert.deepEqual(archive.closed, [true], "mesmo numa falha, o archive aberto deve ser fechado");
  });

  it("um arquivo maior que o limite permitido é recusado antes de baixar", async () => {
    const tooLarge = nodes.map(node => node.id === "f-cbr" ? { ...node, size: String(400 * 1024 * 1024) } : node);
    const media = fakeDriveMedia({ "f-cbr": new Uint8Array([1]) });
    const service = setup(tooLarge, media);
    const result = await service.thumbnail("marvel-hqs", "f-cbr", [ROOT, "f-cbr"]);
    assert.equal(result, null);
    assert.deepEqual(media.calls, [], "o tamanho já era conhecido pelo Drive - nunca deveria ter chegado a baixar");
  });
});

describe("ComicCoverThumbnailService: concorrência e deduplicação", () => {
  const nodes: FakeNode[] = [
    { id: ROOT, name: "HQs da Marvel", mimeType: FOLDER, parent: null },
    { id: "f-cbz", name: "001.cbz", mimeType: "application/x-cbz", parent: ROOT },
  ];

  it("duas solicitações simultâneas da mesma HQ compartilham um único processamento", async () => {
    const page = await realJpegPage({ r: 90, g: 90, b: 90 });
    const zip = zipSync({ "001.jpg": page });
    const withSize = nodes.map(node => node.id === "f-cbz" ? { ...node, size: String(zip.length) } : node);
    const media = fakeDriveMedia({ "f-cbz": zip });
    const service = setup(withSize, media);
    const [first, second] = await Promise.all([
      service.thumbnail("marvel-hqs", "f-cbz", [ROOT, "f-cbz"]),
      service.thumbnail("marvel-hqs", "f-cbz", [ROOT, "f-cbz"]),
    ]);
    assert.ok(first && second);
    assert.deepEqual(first!.image, second!.image);
  });
});

describe("ComicCoverThumbnailService: rota do BFF", () => {
  const fakeService = (result: Awaited<ReturnType<ComicCoverThumbnailService["thumbnail"]>>) =>
    ({ thumbnail: async () => result }) as unknown as ComicCoverThumbnailService;
  const capture = () => {
    const sent: { status?: number; headers: Record<string, string>; body?: Buffer | string } = { headers: {} };
    return {
      sent,
      response: {
        statusCode: 0,
        setHeader(name: string, value: string) { sent.headers[name] = value; },
        getHeader: () => undefined,
        end(body?: Buffer | string) { sent.status = (this as { statusCode: number }).statusCode; sent.body = body; },
      } as never,
    };
  };

  it("a rota é pública, exatamente como /folders", async () => {
    const { isPublicCollectionRequest } = await import("../src/app.js");
    assert.equal(isPublicCollectionRequest("GET", "/api/collections/marvel-hqs/comic-cover/f-cbr"), true);
    assert.equal(isPublicCollectionRequest("POST", "/api/collections/marvel-hqs/comic-cover/f-cbr"), false);
  });

  it("devolve a imagem com Content-Type, ETag e os metadados do ComicInfo.xml como headers X-Comic-*", async () => {
    const { ApiController } = await import("../src/controllers/ApiController.js");
    const { AuthMiddleware } = await import("../src/middleware/requireAuth.js");
    const { DeviceService } = await import("../src/services/DeviceService.js");
    const { LicenseService } = await import("../src/services/LicenseService.js");
    const { MemoryDeviceRepository, MemoryLicenseRepository, MemoryProfileRepository } = await import("../src/repositories/MemoryRepositories.js");
    const image = Buffer.from([1, 2, 3]);
    const service = fakeService({
      image, contentType: "image/jpeg", etag: '"f-cbr-2026-01-01"',
      metadata: { title: "Guerras Secretas", series: null, number: "1", year: null, summary: "Um evento cósmico.", writer: null, publisher: null, genre: null },
    });
    const config = { autoActivateDevLicense: true } as never;
    const controller = new ApiController({} as never, new AuthMiddleware({} as never),
      new DeviceService(new MemoryDeviceRepository(), "secret"), new LicenseService(new MemoryLicenseRepository(), config),
      new MemoryProfileRepository(), undefined, undefined, undefined, undefined, undefined, service);
    const result = capture();
    await controller.handle({ method: "GET", headers: {}, url: "/api/collections/marvel-hqs/comic-cover/f-cbr?path=root,f-cbr" } as never,
      result.response, "/api/collections/marvel-hqs/comic-cover/f-cbr");
    assert.equal(result.sent.status, 200);
    assert.equal(result.sent.headers["Content-Type"], "image/jpeg");
    assert.equal(result.sent.headers["ETag"], '"f-cbr-2026-01-01"');
    assert.equal(decodeURIComponent(result.sent.headers["X-Comic-Title"]!), "Guerras Secretas");
    assert.equal(decodeURIComponent(result.sent.headers["X-Comic-Number"]!), "1");
    assert.equal(decodeURIComponent(result.sent.headers["X-Comic-Summary"]!), "Um evento cósmico.");
    assert.equal("X-Comic-Series" in result.sent.headers, false, "um campo ausente no ComicInfo.xml não vira header nenhum");
    assert.deepEqual(result.sent.body, image);
  });

  it("quando a geração falha, responde 404 em vez de derrubar a requisição", async () => {
    const { ApiController } = await import("../src/controllers/ApiController.js");
    const { AuthMiddleware } = await import("../src/middleware/requireAuth.js");
    const { DeviceService } = await import("../src/services/DeviceService.js");
    const { LicenseService } = await import("../src/services/LicenseService.js");
    const { MemoryDeviceRepository, MemoryLicenseRepository, MemoryProfileRepository } = await import("../src/repositories/MemoryRepositories.js");
    const service = fakeService(null);
    const config = { autoActivateDevLicense: true } as never;
    const controller = new ApiController({} as never, new AuthMiddleware({} as never),
      new DeviceService(new MemoryDeviceRepository(), "secret"), new LicenseService(new MemoryLicenseRepository(), config),
      new MemoryProfileRepository(), undefined, undefined, undefined, undefined, undefined, service);
    const result = capture();
    await controller.handle({ method: "GET", headers: {}, url: "/api/collections/marvel-hqs/comic-cover/f-cbr?path=root,f-cbr" } as never,
      result.response, "/api/collections/marvel-hqs/comic-cover/f-cbr");
    assert.equal(result.sent.status, 404);
  });

  it("sem o serviço configurado, responde 503 em vez de lançar", async () => {
    const { ApiController } = await import("../src/controllers/ApiController.js");
    const { AuthMiddleware } = await import("../src/middleware/requireAuth.js");
    const { DeviceService } = await import("../src/services/DeviceService.js");
    const { LicenseService } = await import("../src/services/LicenseService.js");
    const { MemoryDeviceRepository, MemoryLicenseRepository, MemoryProfileRepository } = await import("../src/repositories/MemoryRepositories.js");
    const config = { autoActivateDevLicense: true } as never;
    const controller = new ApiController({} as never, new AuthMiddleware({} as never),
      new DeviceService(new MemoryDeviceRepository(), "secret"), new LicenseService(new MemoryLicenseRepository(), config),
      new MemoryProfileRepository());
    const result = capture();
    await controller.handle({ method: "GET", headers: {}, url: "/api/collections/marvel-hqs/comic-cover/f-cbr" } as never,
      result.response, "/api/collections/marvel-hqs/comic-cover/f-cbr");
    assert.equal(result.sent.status, 503);
  });
});
