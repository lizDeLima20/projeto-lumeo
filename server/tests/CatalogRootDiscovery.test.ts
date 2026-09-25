import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CatalogRootDiscovery, type DriveFolderEntry } from "../src/catalog/CatalogRootDiscovery.js";
import { ConfiguredCatalogSources } from "../src/catalog/CatalogGenreSources.js";
import { CatalogSourceRegistry } from "../src/catalog/CatalogSourceRegistry.js";
import { HybridCatalogSourceProvider } from "../src/catalog/HybridCatalogSourceProvider.js";
import { PublicCatalogJsonReader, StructuredDriveCatalogProvider } from "../src/catalog/StructuredDriveCatalogProvider.js";
import { PublicDriveFolderReader } from "../src/catalog/PublicDriveFolderReader.js";
import type { CatalogGenreSource, CatalogSourceStore } from "../src/catalog/CatalogSourceRepository.js";

const folder = (id: string, name: string): DriveFolderEntry => ({ id, name, mimeType: "application/vnd.google-apps.folder" });
const file = (id: string, name: string): DriveFolderEntry => ({ id, name, mimeType: "application/json" });
const root1 = "drive-one-root", root2 = "drive-two-root";

function lister(entries: Record<string, readonly DriveFolderEntry[] | Error>) {
  return { listFolderEntries: async (id: string): Promise<readonly DriveFolderEntry[]> => {
    const value = entries[id]; if (value instanceof Error) throw value; return value ?? [];
  } };
}

describe("descoberta automática dos gêneros em dois Drives", () => {
  it("aceita cada Drive isoladamente e elimina pasta duplicada entre raízes", async () => {
    const entries = lister({
      [root1]: [folder("shared-genre", "Ciências")],
      [root2]: [folder("shared-genre", "Ciências")],
      "shared-genre": [folder("book-files", "books"), folder("cover-files", "covers"), file("catalog-file", "catalog.json")],
    });
    assert.deepEqual((await new CatalogRootDiscovery([root1], entries).sources()).map((source) => source.genre), ["Ciências"]);
    assert.deepEqual((await new CatalogRootDiscovery([root2], entries).sources()).map((source) => source.genre), ["Ciências"]);
    const merged = await new ConfiguredCatalogSources([], null, 60_000, new CatalogRootDiscovery([root1, root2], entries)).all();
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.folderId, "shared-genre");
  });

  it("descobre pastas aninhadas e mantém Concurso público e Concursos separados", async () => {
    const discovery = new CatalogRootDiscovery([root1, root2], lister({
      [root1]: [folder("nested-root-1", "Lumeo Catalogo")],
      "nested-root-1": [folder("genre-concurso-publico", "Concurso público"), folder("genre-sem-catalogo", "Incompleto")],
      "genre-concurso-publico": [folder("books-folder-one", "books"), folder("covers-folder-one", "covers"), file("catalog-one", "catalog.json")],
      "genre-sem-catalogo": [folder("books-folder-two", "books")],
      [root2]: [folder("genre-concursos", "Concursos"), folder("genre-hqs-marvel", "HQs da Marvel")],
      "genre-concursos": [folder("books-folder-three", "books"), folder("covers-folder-three", "covers"), file("catalog-two", "catalog.json")],
      "genre-hqs-marvel": [folder("books-folder-four", "books"), folder("covers-folder-four", "covers"), file("catalog-comic", "catalog.json")],
    }));
    const sources = await discovery.sources();
    assert.deepEqual(sources.map((source) => [source.genre, source.folderId]), [
      ["Concurso público", "genre-concurso-publico"], ["Concursos", "genre-concursos"],
    ]);
  });

  it("isola a falha de um Drive e não recria uma fonte já cadastrada", async () => {
    const discovery = new CatalogRootDiscovery([root1, root2], lister({
      [root1]: [folder("genre-artes", "Artes e música")],
      "genre-artes": [folder("books-artes", "books"), folder("covers-artes", "covers"), file("catalog-artes", "catalog.json")],
      [root2]: new Error("DRIVE_FORBIDDEN"),
    }));
    const saved: CatalogGenreSource = {
      id: "00000000-0000-4000-8000-000000000001", genre: "Artes e música",
      driveFolderUrl: "", folderId: "genre-artes", locale: "pt-BR", enabled: true,
      createdAt: "", updatedAt: "",
    };
    const store = { list: async () => [saved] } as CatalogSourceStore;
    const configured = await new ConfiguredCatalogSources([], store, 60_000, discovery).all();
    assert.deepEqual(configured.map((source) => source.folderId), ["genre-artes"]);
  });

  it("agrega os dois Drives, preserva os chips na busca e ignora catálogo inválido", async () => {
    const discovery = new CatalogRootDiscovery([root1, root2], lister({
      [root1]: [folder("genre-ciencias", "Ciências")],
      "genre-ciencias": [folder("books-ciencias", "books"), folder("covers-ciencias", "covers"), file("catalog-ciencias", "catalog.json")],
      [root2]: [folder("genre-ficcao", "Ficção"), folder("genre-invalido", "Inválido")],
      "genre-ficcao": [folder("books-ficcao", "books"), folder("covers-ficcao", "covers"), file("catalog-ficcao", "catalog.json")],
      "genre-invalido": [folder("books-invalidos", "books"), folder("covers-invalidos", "covers"), file("catalog-invalido", "catalog.json")],
    }));
    const sources = new ConfiguredCatalogSources([], null, 60_000, discovery);
    const documents: Record<string, unknown> = {
      "genre-ciencias": [{ bookId: "science-1", title: "Ciência", format: "pdf", driveFileId: "file-science-1" }],
      "genre-ficcao": [{ bookId: "fiction-1", title: "Ficção", format: "epub", driveFileId: "file-fiction-1" }],
      "genre-invalido": { books: "not-an-array" },
    };
    const registry = new CatalogSourceRegistry(() => sources.all(), {
      legacy: () => { throw new Error("legacy not used"); },
      structured: (source) => new StructuredDriveCatalogProvider(source, undefined, undefined, {
        read: async (id) => documents[id] ?? null,
      }),
    });
    const catalog = new HybridCatalogSourceProvider((locale) => registry.providers(locale));
    const page = await catalog.list({ locale: "pt-BR", offset: 0, limit: 24, query: "Ficção" });
    assert.deepEqual(page.items.map((book) => book.title), ["Ficção"]);
    assert.deepEqual(page.genres?.map((genre) => genre.name), ["Ciências", "Ficção"]);
  });
  it("isola uma origem que devolve HTML em vez de catalog.json", async () => {
    const folder = new PublicDriveFolderReader(async () => new Response('<tr data-id="catalog-file-123" aria-label="catalog.json JSON Shared"></tr>'));
    const reader = new PublicCatalogJsonReader(folder, async () => new Response("<!doctype html><html>Sign in</html>", {
      status: 200, headers: { "content-type": "text/html" },
    }));
    await assert.rejects(reader.read("folder-with-html"), { code: "CATALOG_SOURCE_INVALID" });
  });
});
