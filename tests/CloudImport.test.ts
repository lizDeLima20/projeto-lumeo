import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GoogleDriveImporter, PickerCancelledError, type GoogleDriveGateway } from "../src/importers/GoogleDriveImporter";
import { GoogleDriveUrlParser } from "../src/importers/GoogleDriveUrlParser";
import { FolderUrlError, InvalidUrlError, UrlImporter } from "../src/importers/UrlImporter";
import { LocalFileImporter } from "../src/importers/LocalFileImporter";
import { ImportManager } from "../src/services/ImportManager";

const config = { clientId: "client", apiKey: "key", appId: "app" };

describe("GoogleDriveUrlParser", () => {
  const parser = new GoogleDriveUrlParser();
  it("parseFileUrl", () => assert.deepEqual(parser.parse("https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view"), { kind: "file", fileId: "1AbCdEfGhIjKlMn" }));
  it("parseOpenIdUrl", () => assert.deepEqual(parser.parse("https://drive.google.com/open?id=1AbCdEfGhIjKlMn"), { kind: "file", fileId: "1AbCdEfGhIjKlMn" }));
  it("rejectInvalidUrl", () => assert.deepEqual(parser.parse("https://example.com/file/d/1AbCdEfGhIjKlMn"), { kind: "invalid" }));
  it("detectFolderUrl", () => assert.deepEqual(parser.parse("https://drive.google.com/drive/folders/1JUbxHjUzyYruG9LWyz1HRYv9matGU7ad"), { kind: "folder", folderId: "1JUbxHjUzyYruG9LWyz1HRYv9matGU7ad" }));
});

describe("UrlImporter", () => {
  it("successfulDownload", async () => { const fetcher: typeof fetch = async () => new Response("%PDF", { headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=livro.pdf" } });
    const result = await new UrlImporter(undefined, undefined, undefined, fetcher).importFromUrl("https://books.example/livro.pdf"); assert.equal(result.source, "url"); assert.equal(result.fileType, "pdf"); });
  it("rejectUnsupportedType", async () => { const fetcher: typeof fetch = async () => new Response("text", { headers: { "content-type": "text/plain" } });
    await assert.rejects(() => new UrlImporter(undefined, undefined, undefined, fetcher).importFromUrl("https://books.example/notas.txt"), /Formato não suportado/); });
  it("rejectInvalidUrl", async () => await assert.rejects(() => new UrlImporter().importFromUrl("não é link"), InvalidUrlError));
  it("detecta pasta sem baixar", async () => await assert.rejects(() => new UrlImporter().importFromUrl("https://drive.google.com/drive/folders/1JUbxHjUzyYruG9LWyz1HRYv9matGU7ad"), FolderUrlError));
});

describe("GoogleDriveImporter", () => {
  it("cancelPicker", async () => { const gateway: GoogleDriveGateway = { selectFile: async () => null, downloadFile: async () => new File([], "unused.pdf") };
    await assert.rejects(() => new GoogleDriveImporter(config, undefined, gateway).selectFile(), PickerCancelledError); });
  it("successfulDownload", async () => { let downloaded = ""; const gateway: GoogleDriveGateway = { selectFile: async () => ({ id: "file-id", name: "drive.pdf", mimeType: "application/pdf" }),
      downloadFile: async (id) => { downloaded = id; return new File(["%PDF"], "drive.pdf", { type: "application/pdf" }); } };
    const result = await new GoogleDriveImporter(config, undefined, gateway).selectFile(); assert.equal(downloaded, "file-id"); assert.equal(result.source, "google-drive"); assert.equal(result.fileType, "pdf"); });
});

describe("ImportManager remoto", () => {
  it("sendToImportManager", async () => { const remote = { importFromUrl: async () => ({ file: new File(["%PDF"], "remote.pdf", { type: "application/pdf" }), fileType: "pdf" as const,
      suggestedTitle: "remote", source: "url" as const, originalName: "remote.pdf", mimeType: "application/pdf", size: 4 }) };
    const manager = new ImportManager(new LocalFileImporter(), {} as never, {} as never, undefined, remote as UrlImporter);
    const result = await manager.selectUrl("https://books.example/remote.pdf"); assert.equal(result.source, "url"); assert.equal(result.suggestedTitle, "remote"); });
});
