import assert from "node:assert/strict";
import { it } from "node:test";
import { readFile } from "node:fs/promises";
import { GoogleDriveLibraryRepository } from "../src/external/GoogleDriveLibraryRepository";
import { GoogleDriveLibraryService } from "../src/external/GoogleDriveLibraryService";
import { AuthManager, type AuthSession } from "../src/services/AuthManager";
import { ApiError } from "../src/services/ApiClient";
import { AppState } from "../src/core/AppState";
import { BookDownloadError } from "../src/diagnostics/StartTelemetry";
import type { StorageAdapter } from "../src/services/StorageService";
class Memory implements StorageAdapter {
  private rows = new Map<string, unknown>();
  public async load<T>(key: string): Promise<T | null> { return this.rows.get(key) as T ?? null; }
  public async save<T>(key: string, value: T): Promise<void> { this.rows.set(key, value); }
  public async remove(key: string): Promise<void> { this.rows.delete(key); }
}
const url = "https://drive.google.com/drive/folders/folder_123";
it("sourcesCanBeCreatedWithoutGoogleConfigAndPersistPerUser", async () => {
  const storage = new Memory(), repo = new GoogleDriveLibraryRepository(storage, "u");
  await Promise.all([repo.save("Napoleon", url), repo.save("Mangás", url + "x")]);
  assert.equal((await new GoogleDriveLibraryRepository(storage, "u").all()).length, 2);
  assert.equal((await new GoogleDriveLibraryRepository(storage, "other").all()).length, 0);
});
it("renameEditDeleteSourceNeverDeletesBooks", async () => {
  const storage = new Memory(), repo = new GoogleDriveLibraryRepository(storage, "u");
  await storage.save("books", ["preserved"]);
  const source = await repo.save("Before", url);
  const edited = await repo.save("After", url + "new", source.id);
  assert.equal(edited.name, "After"); assert.equal(edited.folderId, "folder_123new"); assert.equal(edited.createdAt, source.createdAt);
  await repo.remove(source.id); assert.deepEqual(await repo.all(), []); assert.deepEqual(await storage.load("books"), ["preserved"]);
});
it("rejectsFileLinksAndHostSpoofingAndEmptyNames", async () => {
  const repo = new GoogleDriveLibraryRepository(new Memory(), "u");
  for (const invalid of ["https://drive.google.com/file/d/abc/view", "https://drive.google.com.evil.test/drive/folders/abc", "http://drive.google.com/drive/folders/abc", "https://user:pass@drive.google.com/drive/folders/abc"]) {
    await assert.rejects(repo.save("Name", invalid), /Insira um link válido de uma pasta do Google Drive/);
  }
  await assert.rejects(repo.save("  ", url));
  assert.equal(GoogleDriveLibraryRepository.parse(url + "?usp=sharing&resourcekey=safe-key").folderUrl, url + "?resourcekey=safe-key");
});
it("unconfiguredGoogleErrorsOnlyWhenOpeningNotWhenSaving", async () => {
  await new GoogleDriveLibraryRepository(new Memory(), "u").save("Works", url);
  await assert.rejects(new GoogleDriveLibraryService("").prepare(), /Google Drive ainda não está configurado/);
});
it("mainImportHasOnlyTwoSourcesAndNoPermanentLinkInput", async () => {
  const source = await readFile("src/views/BookImportView.ts", "utf8");
  assert.match(source, /sourceChoices.append\(device, drive\)/);
  for (const text of ["Por link", "Cole o link do arquivo", "Importar link", "selectDrive("]) assert.equal(source.includes(text), false);
});
it("listTargetsSavedFolderAndDownloadIsDirectWithoutBackend", async () => {
  const calls: string[] = [];
  const service = new GoogleDriveLibraryService("test", async (input) => {
    const value = String(input); calls.push(value);
    if (value.includes("alt=media")) return new Response("%PDF-test");
    if (value.includes("fields=mimeType")) return Response.json({ mimeType: GoogleDriveLibraryService.FOLDER });
    return Response.json({ files: [{ id: "pdf", name: "book.pdf", mimeType: "application/pdf", size: "9" }, { id: "no", name: "notes.txt", mimeType: "text/plain" }], nextPageToken: "next" });
  });
  Object.assign(service, { token: "test-only", expires: Date.now() + 10000 });
  const signal = new AbortController().signal, list = await service.list("folder_123", undefined, signal);
  assert.equal(list.files.length, 1); assert.equal(list.nextPageToken, "next");
  assert.equal(await (await service.download(list.files[0]!, signal, () => undefined)).text(), "%PDF-test");
  assert.ok(calls.every(call => call.startsWith("https://www.googleapis.com/drive/v3/")));
  assert.equal(new URL(calls[1]!).searchParams.get("q"), "'folder_123' in parents and trashed=false");
});
it("expiredSessionWithoutRefreshClearsWithoutRequest", async () => {
  const storage = new Memory(), state = new AppState(); let calls = 0;
  await storage.save<AuthSession>("auth-session", { user: { id: "u", email: "test@example.com" }, accessToken: "fake", refreshToken: "", expiresAt: 1 });
  const auth = new AuthManager({ post: async () => { calls++; }, setAccessToken: () => undefined } as never, storage as never, state);
  await auth.initialize(); assert.equal(calls, 0); assert.equal(state.authStatus, "unauthenticated"); assert.equal(await storage.load("auth-session"), null);
});
it("invalidRefresh400ClearsSessionWithoutThrowingIntoImportUI", async () => {
  const storage = new Memory(), state = new AppState(); let calls = 0;
  await storage.save<AuthSession>("auth-session", { user: { id: "u", email: "test@example.com" }, accessToken: "fake", refreshToken: "invalid-refresh-token", expiresAt: 1 });
  const auth = new AuthManager({ post: async () => { calls++; throw new ApiError(400, "INVALID", "invalid"); }, setAccessToken: () => undefined } as never, storage as never, state);
  await auth.initialize(); assert.equal(calls, 1); assert.equal(state.authStatus, "unauthenticated");
});
it("temporaryRefreshFailureRestoresOfflineSessionWithoutClearingIt", async () => {
  const storage = new Memory(), state = new AppState();
  const saved: AuthSession = { user: { id: "u", email: "test@example.com" }, accessToken: "fake", refreshToken: "valid-refresh-token", expiresAt: 1 };
  await storage.save<AuthSession>("auth-session", saved);
  const auth = new AuthManager({ post: async () => { throw new ApiError(503, "SUPABASE_UNAVAILABLE", "temporarily unavailable"); }, setAccessToken: () => undefined } as never, storage as never, state);
  await auth.initialize();
  assert.equal(state.authStatus, "OFFLINE_AUTHENTICATED");
  assert.deepEqual(await storage.load("auth-session"), saved);
});
it("short stale refresh token clears locally without calling the BFF", async () => {
  const storage = new Memory(), state = new AppState(); let calls = 0;
  await storage.save<AuthSession>("auth-session", { user: { id: "u", email: "test@example.com" }, accessToken: "fake", refreshToken: "short", expiresAt: 1 });
  await new AuthManager({ post: async () => { calls++; }, setAccessToken: () => undefined } as never, storage as never, state).initialize();
  assert.equal(calls, 0); assert.equal(state.authStatus, "unauthenticated");
});
it("validLocalSessionDoesNotRefresh", async () => {
  const storage = new Memory(), state = new AppState(); let calls = 0;
  await storage.save<AuthSession>("auth-session", { user: { id: "u", email: "test@example.com" }, accessToken: "fake", refreshToken: "", expiresAt: null });
  await new AuthManager({ post: async () => { calls++; }, setAccessToken: () => undefined } as never, storage as never, state).initialize();
  assert.equal(calls, 0); assert.equal(state.authStatus, "authenticated");
});

it("mobileCompatibleDownloadRetriesNetworkFailureAndNeverUsesChromeExtension", async () => {
  let calls = 0;
  const service = new GoogleDriveLibraryService("test", async () => {
    calls++;
    if (calls === 1) throw new TypeError("network temporarily unavailable");
    return new Response("epub-data");
  });
  Object.assign(service, { token: "test-only", expires: Date.now() + 10_000 });
  const result = await service.download({ id: "book", name: "book.epub", mimeType: "application/epub+zip", size: "9" }, new AbortController().signal, () => undefined);
  assert.equal(await result.text(), "epub-data"); assert.equal(calls, 2);
  const source = await readFile("src/external/GoogleDriveLibraryService.ts", "utf8");
  for (const forbidden of ["chrome.runtime", "chrome.downloads", "localhost:8765", "localhost:8766", "window.open", "location.href", "AbortSignal.any", "AbortSignal.timeout"]) assert.equal(source.includes(forbidden), false);
});

it("downloadMapsPermanentHttpFailuresAndPreventsDoubleClick", async () => {
  const service = new GoogleDriveLibraryService("test", async () => new Response("no", { status: 403 }));
  Object.assign(service, { token: "test-only", expires: Date.now() + 10_000 });
  const input = { id: "protected", name: "book.epub", mimeType: "application/epub+zip", size: "2" };
  await assert.rejects(service.download(input, new AbortController().signal, () => undefined), (error: unknown) => error instanceof BookDownloadError && error.code === "DOWNLOAD_HTTP_403" && error.status === 403 && !error.retryable);
  let release!: () => void;
  const pendingService = new GoogleDriveLibraryService("test", async () => { await new Promise<void>(resolve => { release = resolve; }); return new Response("ok"); });
  Object.assign(pendingService, { token: "test-only", expires: Date.now() + 10_000 });
  const pending = pendingService.download({ ...input, id: "same", size: "2" }, new AbortController().signal, () => undefined);
  await assert.rejects(pendingService.download({ ...input, id: "same", size: "2" }, new AbortController().signal, () => undefined), (error: unknown) => error instanceof BookDownloadError && error.code === "DOWNLOAD_ALREADY_RUNNING");
  release(); await pending;
});

it("startupFallbackIsReservedForAppStartAndLogsTechnicalFailure", async () => {
  const source = await readFile("src/errors/GlobalErrorHandler.ts", "utf8");
  assert.match(source, /showStartupFailure/); assert.match(source, /StartTelemetry\.failed/);
  assert.equal(source.includes("unhandledrejection\", () => this.showFallback"), false);
});

it("a tela Adicionar livro oferece so dispositivo e Google Drive", async () => {
  const view = await readFile("src/views/BookImportView.ts", "utf8");
  const row = /sourceChoices\.append\(([^)]*)\)/.exec(view);
  assert.ok(row, "nao achei a linha das origens");
  assert.deepEqual(row[1]!.split(",").map(part => part.trim()), ["device", "drive"]);
  // "Por link" foi removido: nem card, nem input permanente, nem botao de importar link
  for (const file of ["src/views/BookImportView.ts", "src/views/ExternalLibrariesPanel.ts"]) {
    const source = await readFile(file, "utf8");
    assert.equal(/por\s*link|cole o link|importar link/i.test(source), false, `${file} ainda oferece importacao por link`);
  }
});

it("cadastrar uma biblioteca nao depende de estar logado", async () => {
  // um 400 em /auth/refresh derruba a sessao; registrar uma pasta do Drive nao tem
  // nada a ver com isso, e antes a modal abria num beco sem saida culpando o disco
  const storage = new Memory();
  const anonymous = new GoogleDriveLibraryRepository(storage, "");
  assert.deepEqual(await anonymous.all(), []);
  const saved = await anonymous.save("Napoleon Hill", "https://drive.google.com/drive/folders/1AbCdEfGhIjK");
  assert.equal(saved.userId, GoogleDriveLibraryRepository.deviceOwner);
  assert.equal(saved.folderId, "1AbCdEfGhIjK");
  assert.equal((await anonymous.all()).length, 1);
  // e o que e do usuario continua sendo dele
  const signedIn = new GoogleDriveLibraryRepository(storage, "user-1");
  assert.deepEqual(await signedIn.all(), []);
  await signedIn.save("Mangas", "https://drive.google.com/drive/folders/2ZzYyXxWw");
  assert.equal((await signedIn.all()).length, 1);
  assert.equal((await anonymous.all()).length, 1);
});
