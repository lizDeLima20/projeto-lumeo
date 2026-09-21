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
    // The collections strip is additive: the genre filters still come only from the catalogue.
    assert.match(explorer, /private async offerCollections/);
    assert.match(explorer, /addGenre\("", this\.t\("ui\.catalog\.allGenres"\)\)/);
    assert.doesNotMatch(explorer, /addCatalogGenre\(\s*"marvel/i);
    // The reader, the comic reader and the library were not touched by this feature.
    assert.doesNotMatch(source("src/views/ReaderView.ts"), /collection[A-Z]|DriveCollection/);
    assert.doesNotMatch(source("src/views/ComicReaderView.ts"), /DriveCollection/);
  });
});
