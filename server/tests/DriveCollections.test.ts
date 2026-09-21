import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DriveCollectionService } from "../src/collections/DriveCollectionService.js";
import { DriveFolderBrowser } from "../src/collections/DriveFolderBrowser.js";
import { DriveFolderCache } from "../src/collections/DriveFolderCache.js";
import { driveCollectionsFromEnvironment, DEFAULT_DRIVE_COLLECTIONS } from "../src/collections/DriveCollectionRegistry.js";
import { compareNaturally, sortEntries } from "../src/collections/NaturalOrder.js";
import { ApiError } from "../src/errors/ApiError.js";

const ROOT = "1wXs64lZ0nOBAAWwGutDHfjO-TnfYO6Ee";
const FOLDER = "application/vnd.google-apps.folder";
const collections = [{ id: "marvel-hqs", name: "HQs da Marvel", rootFolderId: ROOT, contentType: "comic" as const }];

interface FakeNode { id: string; name: string; mimeType: string; parent: string | null; size?: string }

/** A Drive that only ever answers about the folder it was asked about, so a test can see
 *  exactly how many folders a screen cost. */
function fakeDrive(nodes: readonly FakeNode[]) {
  const calls: string[] = [];
  const request = async (url: URL): Promise<Response> => {
    const query = url.searchParams.get("q");
    if (query) {
      const parent = /'([^']+)' in parents/.exec(query)![1]!;
      calls.push(`list:${parent}`);
      const files = nodes.filter(node => node.parent === parent)
        .map(node => ({ id: node.id, name: node.name, mimeType: node.mimeType, size: node.size, modifiedTime: "2026-01-01T00:00:00Z" }));
      return new Response(JSON.stringify({ files }), { status: 200 });
    }
    const id = decodeURIComponent(url.pathname.split("/").pop()!);
    calls.push(`get:${id}`);
    const node = nodes.find(item => item.id === id);
    if (!node) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ id: node.id, name: node.name, mimeType: node.mimeType, parents: node.parent ? [node.parent] : [] }), { status: 200 });
  };
  return { request, calls };
}

const marvel: FakeNode[] = [
  { id: ROOT, name: "HQs da Marvel", mimeType: FOLDER, parent: null },
  { id: "sw", name: "STAR WARS", mimeType: FOLDER, parent: ROOT },
  { id: "xm", name: "X-MEN", mimeType: FOLDER, parent: ROOT },
  { id: "leia-me", name: "Leia-me.pdf", mimeType: "application/pdf", parent: ROOT, size: "1024" },
  // STAR WARS holds arcs and loose issues at the same time.
  { id: "sw-v1", name: "Volume 01", mimeType: FOLDER, parent: "sw" },
  { id: "sw-v2", name: "Volume 02", mimeType: FOLDER, parent: "sw" },
  { id: "sw-v10", name: "Volume 10", mimeType: FOLDER, parent: "sw" },
  { id: "sw-especial", name: "Especial.pdf", mimeType: "application/pdf", parent: "sw", size: "2048" },
  { id: "sw-v1-c1", name: "Capítulo 01.pdf", mimeType: "application/pdf", parent: "sw-v1" },
  { id: "sw-v1-c2", name: "Capítulo 02.pdf", mimeType: "application/pdf", parent: "sw-v1" },
  { id: "sw-v1-c10", name: "Capítulo 10.pdf", mimeType: "application/pdf", parent: "sw-v1" },
  // A fourth level, to prove depth is not fixed anywhere.
  { id: "sw-v1-extra", name: "Extras", mimeType: FOLDER, parent: "sw-v1" },
  { id: "sw-v1-extra-a", name: "Arte.pdf", mimeType: "application/pdf", parent: "sw-v1-extra" },
];

const service = (nodes = marvel) => {
  const drive = fakeDrive(nodes);
  return { drive, service: new DriveCollectionService(collections, new DriveFolderBrowser(drive.request)) };
};

describe("coleções do Drive: configuração", () => {
  it("1. HQs da Marvel vem de uma configuração única", () => {
    assert.equal(DEFAULT_DRIVE_COLLECTIONS.length, 1);
    const [marvelConfig] = DEFAULT_DRIVE_COLLECTIONS;
    assert.deepEqual({ ...marvelConfig }, { id: "marvel-hqs", name: "HQs da Marvel", rootFolderId: ROOT, contentType: "comic" });
  });
  it("uma coleção nova é configuração, não código", () => {
    const parsed = driveCollectionsFromEnvironment(JSON.stringify([
      { id: "dc-hqs", name: "HQs da DC", rootFolderId: "0BxAbCdEfGhIjKlMnOpQ" },
    ]));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.id, "dc-hqs");
  });
  it("configuração inválida não derruba o app", () => {
    assert.deepEqual(driveCollectionsFromEnvironment("{ não é json"), DEFAULT_DRIVE_COLLECTIONS);
    assert.deepEqual(driveCollectionsFromEnvironment(JSON.stringify([{ id: "x", name: "", rootFolderId: "curto" }])), DEFAULT_DRIVE_COLLECTIONS);
  });
});

describe("coleções do Drive: navegação sob demanda", () => {
  it("2. abre somente o primeiro nível", async () => {
    const { drive, service: value } = service();
    const listing = await value.open("marvel-hqs");
    assert.deepEqual(listing.entries.map(entry => entry.name), ["STAR WARS", "X-MEN", "Leia-me.pdf"]);
    // Exactly one folder was read: the tree below was never touched.
    assert.deepEqual(drive.calls, [`list:${ROOT}`]);
    assert.deepEqual(listing.breadcrumb, [{ id: ROOT, name: "HQs da Marvel" }]);
  });
  it("3. entrar em STAR WARS abre somente os filhos de STAR WARS", async () => {
    const { drive, service: value } = service();
    await value.open("marvel-hqs");
    drive.calls.length = 0;
    const listing = await value.open("marvel-hqs", "sw", [ROOT, "sw"]);
    assert.deepEqual(listing.entries.map(entry => entry.name), ["Volume 01", "Volume 02", "Volume 10", "Especial.pdf"]);
    assert.ok(!drive.calls.includes("list:sw-v1"), "não pode descer sozinho para dentro dos volumes");
    assert.ok(drive.calls.includes("list:sw"));
    assert.deepEqual(listing.breadcrumb.map(step => step.name), ["HQs da Marvel", "STAR WARS"]);
  });
  it("4. aceita vários níveis, com breadcrumb completo", async () => {
    const { service: value } = service();
    const listing = await value.open("marvel-hqs", "sw-v1-extra", [ROOT, "sw", "sw-v1", "sw-v1-extra"]);
    assert.deepEqual(listing.breadcrumb.map(step => step.name), ["HQs da Marvel", "STAR WARS", "Volume 01", "Extras"]);
    assert.deepEqual(listing.entries.map(entry => entry.name), ["Arte.pdf"]);
  });
  it("5. pasta com subpastas e arquivos não perde nenhum item", async () => {
    const { service: value } = service();
    const listing = await value.open("marvel-hqs", "sw-v1", [ROOT, "sw", "sw-v1"]);
    assert.equal(listing.entries.length, 4);
    assert.deepEqual(listing.entries.map(entry => entry.kind), ["folder", "file", "file", "file"]);
    assert.deepEqual(listing.entries.map(entry => entry.name), ["Extras", "Capítulo 01.pdf", "Capítulo 02.pdf", "Capítulo 10.pdf"]);
  });
  it("7. uma pasta nova no Drive aparece sem mexer no código", async () => {
    const withNewFolder = [...marvel, { id: "novo", name: "AVENGERS", mimeType: FOLDER, parent: ROOT }];
    const { service: value } = service(withNewFolder);
    const listing = await value.open("marvel-hqs");
    assert.ok(listing.entries.some(entry => entry.id === "novo" && entry.name === "AVENGERS"));
  });
  it("ordenação natural: 01, 02, 10 - nunca 01, 10, 02", async () => {
    const { service: value } = service();
    const listing = await value.open("marvel-hqs", "sw", [ROOT, "sw"]);
    assert.deepEqual(listing.entries.filter(entry => entry.kind === "folder").map(entry => entry.name), ["Volume 01", "Volume 02", "Volume 10"]);
    assert.ok(compareNaturally("Capítulo 2", "Capítulo 10") < 0);
    assert.deepEqual(sortEntries([
      { name: "Capítulo 10", kind: "file" as const }, { name: "Capítulo 2", kind: "file" as const }, { name: "Arco", kind: "folder" as const },
    ]).map(entry => entry.name), ["Arco", "Capítulo 2", "Capítulo 10"]);
  });
  it("identidade é o id do Drive, não o nome", async () => {
    const twins = [...marvel,
      { id: "gemeo-a", name: "Volume 01", mimeType: FOLDER, parent: "xm" },
      { id: "gemeo-b", name: "Volume 01", mimeType: FOLDER, parent: "xm" }];
    const { service: value } = service(twins);
    const listing = await value.open("marvel-hqs", "xm", [ROOT, "xm"]);
    assert.deepEqual(listing.entries.map(entry => entry.id), ["gemeo-a", "gemeo-b"]);
  });
});

describe("coleções do Drive: cache e limites", () => {
  it("6. voltar usa cache em vez de consultar o Drive de novo", async () => {
    const { drive, service: value } = service();
    await value.open("marvel-hqs");
    await value.open("marvel-hqs", "sw", [ROOT, "sw"]);
    const before = drive.calls.length;
    await value.open("marvel-hqs", "sw", [ROOT, "sw"]);
    await value.open("marvel-hqs");
    assert.equal(drive.calls.length, before, "voltar não pode gerar nenhuma chamada nova");
  });
  it("o cache expira, então uma pasta nova aparece sem deploy", async () => {
    let now = 0;
    const cache = new DriveFolderCache<readonly never[]>(1000, 10, () => now);
    cache.set("a", [] as readonly never[]);
    assert.ok(cache.get("a"));
    now = 1001;
    assert.equal(cache.get("a"), null);
  });
  it("uma pasta fora da coleção é recusada", async () => {
    const intruder = [...marvel, { id: "fora", name: "Pasta privada", mimeType: FOLDER, parent: "outra-raiz" }];
    const { service: value } = service(intruder);
    await assert.rejects(() => value.open("marvel-hqs", "fora", [ROOT, "fora"]), (error: unknown) =>
      error instanceof ApiError && error.code === "COLLECTION_FOLDER_NOT_FOUND");
  });
  it("uma pasta sem caminho comprovado é recusada", async () => {
    // The guard descends from the root instead of climbing from the folder, because the
    // real source answers files.get without a `parents` field: there is no chain to climb.
    const { service: value } = service();
    await assert.rejects(() => value.open("marvel-hqs", "sw"), (error: unknown) =>
      error instanceof ApiError && error.code === "COLLECTION_FOLDER_NOT_FOUND");
    await assert.rejects(() => value.open("marvel-hqs", "sw", ["outra-raiz", "sw"]), (error: unknown) =>
      error instanceof ApiError && error.code === "COLLECTION_FOLDER_NOT_FOUND");
    // The path must actually end at the folder being opened.
    await assert.rejects(() => value.open("marvel-hqs", "sw-v1", [ROOT, "sw"]), (error: unknown) =>
      error instanceof ApiError && error.code === "COLLECTION_FOLDER_NOT_FOUND");
  });
  it("uma coleção desconhecida é recusada", async () => {
    const { service: value } = service();
    await assert.rejects(() => value.open("nao-existe"), (error: unknown) =>
      error instanceof ApiError && error.code === "COLLECTION_NOT_FOUND");
  });
});

describe("coleções do Drive: rotas do BFF", () => {
  it("as rotas de leitura são públicas, as demais não", async () => {
    const { isPublicCollectionRequest } = await import("../src/app.js");
    assert.equal(isPublicCollectionRequest("GET", "/api/collections"), true);
    assert.equal(isPublicCollectionRequest("GET", "/api/collections/marvel-hqs/folders"), true);
    assert.equal(isPublicCollectionRequest("GET", `/api/collections/marvel-hqs/folders/${ROOT}`), true);
    assert.equal(isPublicCollectionRequest("POST", "/api/collections"), false);
    assert.equal(isPublicCollectionRequest("GET", "/api/collections/marvel-hqs/folders/../../secret"), false);
    assert.equal(isPublicCollectionRequest("GET", "/api/me"), false);
  });
  it("o controlador responde coleções e pastas", async () => {
    const { ApiController } = await import("../src/controllers/ApiController.js");
    const { AuthMiddleware } = await import("../src/middleware/requireAuth.js");
    const { DeviceService } = await import("../src/services/DeviceService.js");
    const { LicenseService } = await import("../src/services/LicenseService.js");
    const { MemoryDeviceRepository, MemoryLicenseRepository, MemoryProfileRepository } = await import("../src/repositories/MemoryRepositories.js");
    const { service: collections } = service();
    const config = { autoActivateDevLicense: true } as never;
    const controller = new ApiController({} as never, new AuthMiddleware({} as never),
      new DeviceService(new MemoryDeviceRepository(), "secret"), new LicenseService(new MemoryLicenseRepository(), config),
      new MemoryProfileRepository(), undefined, undefined, undefined, collections);

    const capture = () => { const sent: { status?: number; body?: unknown } = {};
      return { sent, response: { statusCode: 0, setHeader: () => undefined, getHeader: () => undefined,
        end(body: string) { sent.status = (this as { statusCode: number }).statusCode; sent.body = JSON.parse(body); } } as never }; };

    const list = capture();
    await controller.handle({ method: "GET", headers: {} } as never, list.response, "/api/collections");
    assert.equal(list.sent.status, 200);
    assert.deepEqual((list.sent.body as { items: { id: string }[] }).items.map(item => item.id), ["marvel-hqs"]);

    const folder = capture();
    await controller.handle({ method: "GET", headers: {}, url: `/api/collections/marvel-hqs/folders/sw?path=${ROOT},sw` } as never, folder.response, "/api/collections/marvel-hqs/folders/sw");
    assert.equal(folder.sent.status, 200);
    const body = folder.sent.body as { folderId: string; entries: { name: string }[]; breadcrumb: { name: string }[] };
    assert.equal(body.folderId, "sw");
    assert.deepEqual(body.breadcrumb.map(step => step.name), ["HQs da Marvel", "STAR WARS"]);
    assert.deepEqual(body.entries.map(entry => entry.name), ["Volume 01", "Volume 02", "Volume 10", "Especial.pdf"]);
  });
});
