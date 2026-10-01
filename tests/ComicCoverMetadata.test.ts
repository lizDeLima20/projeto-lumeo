import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComicCoverGenerator } from "../src/services/ComicCoverGenerator";
import type { DriveFolderEntry } from "../src/services/DriveCollectionService";

const entry = (id: string, modifiedAt = "v1"): DriveFolderEntry => ({
  id, modifiedAt, name: "001.cbz", kind: "file", mimeType: "application/zip", format: "cbz",
  supported: true, contentType: "comic", size: 10, parentId: "series", collectionPath: ["root", "series", id],
});

function cache() {
  const values = new Map<string, { key: string; dataUrl: string; metadata?: import("../src/services/ComicPresentationService").ComicMetadata; updatedAt: string }>();
  return {
    get: async (key: string) => values.get(key)?.dataUrl ?? null,
    getEntry: async (key: string) => values.get(key) ?? null,
    save: async (key: string, dataUrl: string, metadata?: import("../src/services/ComicPresentationService").ComicMetadata) => {
      values.set(key, { key, dataUrl, metadata, updatedAt: "now" });
    },
  };
}

describe("ComicInfo acompanha a capa no cache", () => {
  it("preserva os headers do mesmo request e um cache hit não repete a rede", async () => {
    let requests = 0;
    const repository = cache();
    const api = { getRaw: async () => {
      requests++;
      return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), { headers: {
        "Content-Type": "image/jpeg", "X-Comic-Title": encodeURIComponent("Título real"),
        "X-Comic-Series": encodeURIComponent("Série real"), "X-Comic-Number": "1",
        "X-Comic-Year": "1963", "X-Comic-Writer": encodeURIComponent("Autora"),
        "X-Comic-Summary": encodeURIComponent("Sinopse real"),
      } });
    } };
    const covers = { fromBlob: async () => "data:image/jpeg;base64,REAL" };
    const generator = new ComicCoverGenerator(repository as never, api, covers as never);
    const first = await generator.resolve("marvel-hqs", entry("same-file"));
    const second = await generator.resolve("marvel-hqs", entry("same-file"));
    assert.equal(requests, 1);
    assert.equal(second?.dataUrl, first?.dataUrl);
    assert.deepEqual(second?.metadata, first?.metadata);
    assert.equal(first?.metadata.title, "Título real");
    assert.equal(first?.metadata.summary, "Sinopse real");
  });

  it("fileIds distintos com o mesmo filename permanecem isolados", async () => {
    let requests = 0;
    const generator = new ComicCoverGenerator(cache() as never, { getRaw: async path => {
      requests++;
      const id = path.includes("file-a") ? "A" : "B";
      return new Response(new Blob([id], { type: "image/jpeg" }), { headers: { "Content-Type": "image/jpeg", "X-Comic-Title": id } });
    } }, { fromBlob: async (blob: Blob) => `data:image/jpeg,${await blob.text()}` } as never);
    assert.equal((await generator.resolve("marvel-hqs", entry("file-a")))?.metadata.title, "A");
    assert.equal((await generator.resolve("marvel-hqs", entry("file-b")))?.metadata.title, "B");
    assert.equal(requests, 2);
  });
});
