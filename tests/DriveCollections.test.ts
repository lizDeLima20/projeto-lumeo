import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DriveCollectionService } from "../src/services/DriveCollectionService";
import type { ApiClient } from "../src/services/ApiClient";

const source = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ROOT = "1wXs64lZ0nOBAAWwGutDHfjO-TnfYO6Ee";

function fakeApi(responses: Record<string, unknown>) {
  const calls: string[] = [];
  const api = {
    get: async <T>(path: string, authenticated = true): Promise<T> => {
      calls.push(`${path}${authenticated ? "|auth" : ""}`);
      if (!(path in responses)) throw new Error(`404 ${path}`);
      return responses[path] as T;
    },
  } as unknown as ApiClient;
  return { api, calls };
}

const listing = (folderId: string, entries: unknown[], breadcrumb: unknown[]) =>
  ({ collectionId: "marvel-hqs", folderId, breadcrumb, entries });

/** The flattened /search-index responses for Marvel and DC, as the server would build
 *  them - one request per collection, not one per folder. */
function marvelAndDcIndexes(): Record<string, unknown> {
  const dcRoot = "dc-root";
  const file = (id: string, name: string) => ({ id, name, kind: "file", mimeType: "application/pdf", format: "pdf", supported: true, size: 10, modifiedAt: null });
  const indexed = (entry: unknown, breadcrumb: unknown[]) => ({ entry, breadcrumb });
  return {
    "/collections": { items: [
      { id: "marvel-hqs", name: "HQs da Marvel", rootFolderId: ROOT },
      { id: "dc-hqs", name: "HQs da DC", rootFolderId: dcRoot },
    ] },
    "/collections/marvel-hqs/search-index": { collectionId: "marvel-hqs", entries: [
      indexed(file("h1", "Hulk 001.pdf"), [{ id: ROOT, name: "HQs da Marvel" }, { id: "hulk", name: "Hulk" }]),
      indexed(file("h2", "O Incrível Hulk 002.cbz"), [{ id: ROOT, name: "HQs da Marvel" }, { id: "hulk", name: "Hulk" }]),
      indexed(file("v1", "Os Vingadores 001.pdf"), [{ id: ROOT, name: "HQs da Marvel" }, { id: "vingadores", name: "Os Vingadores" }]),
      indexed(file("v2", "Vingadores Ultimato.cbz"), [{ id: ROOT, name: "HQs da Marvel" }, { id: "vingadores", name: "Os Vingadores" }]),
      indexed(file("e1", "Doutor_Estranho-001.pdf"), [{ id: ROOT, name: "HQs da Marvel" }, { id: "estranho", name: "Doutor Estranho" }]),
    ] },
    "/collections/dc-hqs/search-index": { collectionId: "dc-hqs", entries: [
      indexed(file("d1", "Ano Um 01.cbz"), [{ id: dcRoot, name: "HQs da DC" }, { id: "batman", name: "Batman" }]),
    ] },
  };
}

describe("coleções publicadas no cliente", () => {
  it("1. lista as coleções sem exigir autenticação do usuário", async () => {
    const { api, calls } = fakeApi({ "/collections": { items: [{ id: "marvel-hqs", name: "HQs da Marvel", rootFolderId: ROOT }] } });
    const collections = await new DriveCollectionService(api).list();
    assert.deepEqual(collections.map(item => item.name), ["HQs da Marvel"]);
    // The `false` flag is what keeps the request anonymous end to end.
    assert.deepEqual(calls, ["/collections"]);
  });
  it("2. abre somente a pasta pedida", async () => {
    const { api, calls } = fakeApi({
      [`/collections/marvel-hqs/folders`]: listing(ROOT, [{ id: "sw", name: "STAR WARS", kind: "folder" }], [{ id: ROOT, name: "HQs da Marvel" }]),
    });
    const service = new DriveCollectionService(api);
    await service.open("marvel-hqs");
    assert.deepEqual(calls, ["/collections/marvel-hqs/folders"]);
  });
  it("3. entrar numa pasta pede exatamente aquele folderId", async () => {
    const { api, calls } = fakeApi({
      "/collections/marvel-hqs/folders/sw": listing("sw", [{ id: "v1", name: "Volume 01", kind: "folder" }],
        [{ id: ROOT, name: "HQs da Marvel" }, { id: "sw", name: "STAR WARS" }]),
    });
    const service = new DriveCollectionService(api);
    const value = await service.open("marvel-hqs", "sw");
    assert.deepEqual(calls, ["/collections/marvel-hqs/folders/sw"]);
    assert.deepEqual(value.breadcrumb.map(step => step.name), ["HQs da Marvel", "STAR WARS"]);
  });
  it("6. voltar usa cache por folderId", async () => {
    const { api, calls } = fakeApi({
      "/collections/marvel-hqs/folders": listing(ROOT, [], [{ id: ROOT, name: "HQs da Marvel" }]),
      "/collections/marvel-hqs/folders/sw": listing("sw", [], [{ id: ROOT, name: "HQs da Marvel" }, { id: "sw", name: "STAR WARS" }]),
    });
    const service = new DriveCollectionService(api);
    await service.open("marvel-hqs");
    await service.open("marvel-hqs", "sw");
    assert.equal(calls.length, 2);
    await service.open("marvel-hqs", "sw");
    await service.open("marvel-hqs");
    assert.equal(calls.length, 2, "voltar não pode gerar pedido novo");
    // The root is cached under its own Drive id too, so a breadcrumb click also hits it.
    assert.equal(service.isCached("marvel-hqs", ROOT), true);
  });
  it("uma coleção indisponível não quebra a tela Explorar", async () => {
    const { api } = fakeApi({});
    assert.deepEqual(await new DriveCollectionService(api).list(), []);
  });
  it("busca Marvel e DC no catálogo completo, normalizada e isolada por coleção", async () => {
    const { api, calls } = fakeApi(marvelAndDcIndexes());
    const service = new DriveCollectionService(api);
    assert.equal((await service.search("hulk")).length, 2);
    assert.equal((await service.search("vingadores", "marvel-hqs")).length, 2);
    assert.equal((await service.search("Doutor Estranho", "marvel-hqs")).length, 1);
    assert.equal((await service.search("doutor-estranho", "marvel-hqs")).length, 1);
    assert.equal((await service.search("bat ano", "dc-hqs")).length, 1);
    assert.equal((await service.search("batman", "marvel-hqs")).length, 0);
    assert.equal((await service.search("hulk", "dc-hqs")).length, 0);
    const requestsAfterIndex = calls.length;
    await service.search("vingadores");
    assert.equal(calls.length, requestsAfterIndex, "a pesquisa seguinte deve reutilizar o catálogo completo indexado");
  });

  it("5. a primeira busca faz exatamente uma chamada de índice por coleção necessária", async () => {
    const { api, calls } = fakeApi(marvelAndDcIndexes());
    const service = new DriveCollectionService(api);
    await service.search("hulk", "marvel-hqs");
    assert.deepEqual(calls, ["/collections", "/collections/marvel-hqs/search-index"], "não pode existir mais nenhuma chamada por pasta - só a lista de coleções e o índice inteiro, de uma vez");
  });

  it("6. a segunda busca na mesma coleção não gera nenhuma chamada adicional", async () => {
    const { api, calls } = fakeApi(marvelAndDcIndexes());
    const service = new DriveCollectionService(api);
    await service.search("hulk", "marvel-hqs");
    const afterFirst = calls.length;
    await service.search("vingadores", "marvel-hqs");
    await service.search("estranho", "marvel-hqs");
    assert.equal(calls.length, afterFirst, "indexes local já resolvido não deve gerar requisição nova");
  });

  it("11. o resultado preserva a identidade necessária para o card/abertura da HQ", async () => {
    const { api } = fakeApi(marvelAndDcIndexes());
    const service = new DriveCollectionService(api);
    const [hulk] = await service.search("hulk 001", "marvel-hqs");
    assert.equal(hulk!.entry.id, "h1");
    assert.equal(hulk!.collection.id, "marvel-hqs");
    assert.equal(hulk!.listing.folderId, "hulk", "folderId deve ser a pasta imediata onde o arquivo está, não a raiz");
    assert.deepEqual(hulk!.listing.breadcrumb.map(step => step.name), ["HQs da Marvel", "Hulk"]);
  });

  it("forget() continua limpando o índice local, forçando nova busca de índice", async () => {
    const { api, calls } = fakeApi(marvelAndDcIndexes());
    const service = new DriveCollectionService(api);
    await service.search("hulk", "marvel-hqs");
    const afterFirst = calls.length;
    service.forget();
    await service.search("hulk", "marvel-hqs");
    assert.ok(calls.length > afterFirst, "depois de forget(), a coleção teve que ser reindexada");
  });
});

describe("coleções: integração e limites", () => {
  it("7. a fonte está centralizada numa configuração única", () => {
    const registry = source("server/src/collections/DriveCollectionRegistry.ts");
    assert.match(registry, /id: "marvel-hqs", name: "HQs da Marvel", rootFolderId: "1wXs64lZ0nOBAAWwGutDHfjO-TnfYO6Ee"/);
    assert.match(registry, /DRIVE_COLLECTIONS_JSON|driveCollectionsFromEnvironment/);
    // No folder name from inside the tree may be hardcoded anywhere.
    const browser = source("src/views/CollectionBrowserView.ts");
    assert.doesNotMatch(browser, /STAR WARS|Volume 0|Capítulo|X-MEN/i);
    assert.doesNotMatch(source("src/services/DriveCollectionService.ts"), /STAR WARS|Volume 0|Capítulo/i);
  });
  it("o navegador lê uma pasta por vez, nunca a árvore toda", () => {
    const browser = source("server/src/collections/DriveFolderBrowser.ts");
    assert.match(browser, /in parents and trashed = false/);
    // A recursive walk is exactly what this must not do: children() never calls itself,
    // and there is no tree-visiting helper here.
    assert.doesNotMatch(browser, /this\.children\(/);
    assert.doesNotMatch(browser, /visitFolder|walkTree/);
  });
  it("nada de scraping da página do Drive nem de rclone", () => {
    for (const file of ["server/src/collections/DriveFolderBrowser.ts", "server/src/collections/DriveCollectionService.ts", "src/services/DriveCollectionService.ts"]) {
      assert.doesNotMatch(source(file), /drive\.google\.com\/drive\/folders|embeddedfolderview|rclone/i, file);
    }
    assert.match(source("server/src/collections/DriveFolderBrowser.ts"), /googleapis\.com\/drive\/v3\/files/);
  });
  it("a navegação das coleções é pública: o leitor não faz login", () => {
    const app = source("server/src/app.ts");
    assert.match(app, /isPublicCollectionRequest/);
    assert.match(app, /isPublicCatalogRequest\(request\.method, path\) \|\| isPublicCollectionRequest\(request\.method, path\)/);
  });
  it("8. o catálogo e os livros normais seguem intactos", () => {
    const explorer = source("src/views/CatalogExplorerView.ts");
    // Published collections are genre chips, not a second visual strip.
    assert.match(explorer, /private async offerCollections/);
    assert.match(explorer, /addGenre\("", this\.t\("ui\.catalog\.allGenres"\)\)/);
    assert.match(explorer, /addGenre\(`collection:\$\{collection\.id\}`/);
    assert.doesNotMatch(explorer, /catalog__collection/);
    assert.match(explorer, /published\.collections\.search\(normalizedQuery\)/);
    // The reader, the comic reader and the library were not touched by this feature.
    assert.doesNotMatch(source("src/views/ReaderView.ts"), /collection[A-Z]|DriveCollection/);
    assert.doesNotMatch(source("src/views/ComicReaderView.ts"), /DriveCollection/);
  });
});
