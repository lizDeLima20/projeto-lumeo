import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { AndroidCatalogDownloadService, HybridCatalogDownloadService, type AndroidCatalogDownloadBridge, type CatalogDownloadService } from "../src/services/CatalogDownloadService";
import type { CatalogDownloadLink } from "../src/services/CatalogService";

const link: CatalogDownloadLink = {
  bookId: "catalog-book-1", driveFileId: "drive-book-1", downloadUrl: "https://drive.google.com/uc?id=drive-book-1",
  title: "Livro", author: "Autora", genreId: "study", genreName: "Estudos", format: "pdf", filename: "livro.pdf",
  expectedFilename: "livro.pdf", fileSize: 7, sha256: null, expiresAt: null,
};

describe("download nativo Android do catálogo", () => {
  it("seleciona o serviço Android somente pela fronteira de plataforma e entrega um File ao ImportManager", async () => {
    const nativeFile = { name: "livro.pdf", size: 7, type: "application/pdf" } as File;
    const bridge: AndroidCatalogDownloadBridge = { downloadToPrivateStorage: async (_link, progress) => { progress?.(7, 7); return nativeFile; } };
    const android = new AndroidCatalogDownloadService(bridge);
    const web: CatalogDownloadService = { target: "browser-download", download: async () => ({ kind: "browser-download" }) };
    const service = new HybridCatalogDownloadService(web, android);
    const updates: number[] = [];
    const result = await service.download(link, current => updates.push(current));
    assert.equal(service.target, "android-private-storage");
    assert.deepEqual(result, { kind: "native-file", file: nativeFile });
    assert.deepEqual(updates, [7]);
  });

  it("mantém o Android em armazenamento privado, com apenas INTERNET e plugin registrado", async () => {
    const manifest = await readFile("android/app/src/main/AndroidManifest.xml", "utf8");
    const activity = await readFile("android/app/src/main/java/com/lumeo/reader/MainActivity.java", "utf8");
    const plugin = await readFile("android/app/src/main/java/com/lumeo/reader/NativeBookDownloadPlugin.java", "utf8");
    assert.match(manifest, /android\.permission\.INTERNET/);
    assert.doesNotMatch(manifest, /MANAGE_EXTERNAL_STORAGE|READ_MEDIA|WRITE_EXTERNAL_STORAGE/);
    assert.match(activity, /registerPlugin\(NativeBookDownloadPlugin\.class\)/);
    assert.match(plugin, /getFilesDir\(\)/);
    assert.match(plugin, /lumeo-books/);
    assert.match(plugin, /new File\(directory, safeBookId \+ "\.part"\)/);
    assert.match(plugin, /followRedirects\(true\)/);
    assert.match(plugin, /bookDownloadProgress/);
    assert.match(plugin, /bookDownloadCompleted/);
    assert.match(plugin, /DOWNLOAD_HTML_RESPONSE/);
  });
});
