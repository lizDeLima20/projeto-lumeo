import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { strToU8, zipSync } from "fflate";
import { BackupService } from "../src/backup/BackupService";
import { BackupValidator } from "../src/backup/BackupValidator";
import { EnvironmentConfig } from "../src/config/EnvironmentConfig";
import { EpubSanitizer } from "../src/security/EpubSanitizer";
import { FileSecurityValidator } from "../src/security/FileSecurityValidator";
import { ZipSecurityValidator } from "../src/security/ZipSecurityValidator";
import { LicenseManager, LicenseRepository } from "../src/license/LicenseManager";
import { StorageService } from "../src/services/StorageService";

class MemoryStorage {
  private readonly rows = new Map<string, unknown>();
  public async load<T>(key: string): Promise<T | null> { return this.rows.get(key) as T ?? null; }
  public async save<T>(key: string, value: T): Promise<void> { this.rows.set(key, value); }
  public async remove(key: string): Promise<void> { this.rows.delete(key); }
}

describe("produção e segurança do frontend", () => {
  it("productionApiNeverUsesLocalhostOverride", () => {
    const config = new EnvironmentConfig({ MODE: "production", VITE_API_URL: "http://localhost:3000/api" } as ImportMetaEnv).read();
    assert.equal(config.bffBaseUrl, "/api");
  });
  it("developmentKeepsLocalBff", () => {
    assert.equal(new EnvironmentConfig({ MODE: "development" } as ImportMetaEnv).read().bffBaseUrl, "http://localhost:3000/api");
  });
  it("androidBuildUsesExplicitPublicBffInsteadOfWebViewLocalhost", () => {
    const config = new EnvironmentConfig({ MODE: "production", PROD: true, VITE_CAPACITOR_API_URL: "https://lumeo-livros.vercel.app/api/" } as ImportMetaEnv, () => true).read();
    assert.equal(config.bffBaseUrl, "https://lumeo-livros.vercel.app/api");
  });
  it("frontendDoesNotContainServiceRoleKey", () => {
    const config = new EnvironmentConfig({ MODE: "production", VITE_APP_ENV: "production" } as ImportMetaEnv);
    assert.equal(config.assertNoFrontendSecrets(["VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_URL", "VITE_API_URL"]), true);
    assert.equal(config.assertNoFrontendSecrets(["VITE_SUPABASE_SECRET_KEY"]), false);
    assert.equal(config.assertNoSecretValues(["sb_publishable_demo"]), true);
    assert.equal(config.assertNoSecretValues(["sb_secret_demo"]), false);
  });

  it("rejectsInvalidPdfSignature", async () => {
    await assert.rejects(() => new FileSecurityValidator().validate(new File(["not-a-pdf"], "x.pdf", { type: "application/pdf" }), "pdf"), /invalidPdfSignature/);
  });

  it("rejectsZipTraversal", () => {
    assert.throws(() => new ZipSecurityValidator().validatePath("../evil.txt"), /zipTraversal/);
  });

  it("rejectsZipBombLikeArchive", () => {
    const archive = zipSync({ "a.txt": strToU8("a".repeat(2000)) });
    assert.throws(() => new ZipSecurityValidator({ maxFiles: 10, maxExpandedBytes: 100, maxExpansionRatio: 100 }).validate(archive), /zipBomb/);
  });

  it("epubScriptIsSanitized", () => {
    assert.equal(new EpubSanitizer().sanitize("<p>ok</p><script>alert(1)</script>").includes("script"), false);
  });

  it("javascriptUrlIsBlocked", () => {
    assert.equal(new EpubSanitizer().sanitize('<a href="javascript:alert(1)">x</a>').includes("javascript:"), false);
  });

  it("backupManifestIsValidated", () => {
    assert.equal(new BackupValidator().validate(new BackupService().createLight({ books: [] })).valid, true);
    assert.equal(new BackupValidator().validate({ manifest: { format: "bad" } as never }).valid, false);
  });

  it("activeLicenseWorksOfflineWithinGrace", async () => {
    const manager = new LicenseManager(new LicenseRepository(new MemoryStorage()));
    await manager.cacheOnlineState("ACTIVE");
    assert.equal(await manager.stateWhenOffline(), "OFFLINE_GRACE");
  });

  it("expiredOfflineGraceDoesNotBecomePermanent", async () => {
    const storage = new MemoryStorage();
    await storage.save("license-cache", { state: "ACTIVE", validatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() });
    assert.equal(await new LicenseManager(new LicenseRepository(storage)).stateWhenOffline(), "EXPIRED");
  });

  it("frontendCannotSelfActivateLicense", () => {
    assert.equal(new LicenseManager(new LicenseRepository(new StorageService())).canFrontendActivateLicense(), false);
  });

  it("onlineValidationRefreshesLicenseCache", async () => {
    const storage = new MemoryStorage(), repository = new LicenseRepository(storage), manager = new LicenseManager(repository);
    await manager.cacheOnlineState("ACTIVE");
    assert.equal((await repository.load())?.state, "ACTIVE");
  });

  it("serviceWorkerDoesNotCacheBookFilesOrSensitiveApi", async () => {
    const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
    assert.match(sw, /BOOK_FILE_PATTERN/);
    assert.match(sw, /request\.headers\.has\("Authorization"\)/);
    assert.doesNotMatch(sw, /url\.pathname\.startsWith\("\/api\/"\)/);
  });

  it("permite o popup e os estilos oficiais do Google Identity", async () => {
    const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8")) as { headers: Array<{ headers: Array<{ key: string; value: string }> }> };
    const headers = new Map(config.headers[0]!.headers.map(({ key, value }) => [key, value]));
    assert.equal(headers.get("Cross-Origin-Opener-Policy"), "same-origin-allow-popups");
    assert.match(headers.get("Content-Security-Policy") ?? "", /style-src[^;]*https:\/\/fonts\.googleapis\.com/);
    assert.match(headers.get("Content-Security-Policy") ?? "", /font-src[^;]*https:\/\/fonts\.gstatic\.com/);
  });
});
