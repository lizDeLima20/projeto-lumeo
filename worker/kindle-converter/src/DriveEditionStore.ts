import { createHash } from "node:crypto";
import { KINDLE_DRIVE_FOLDER_NAME, KINDLE_FILE_TYPES } from "../../../server/src/kindle/KindleEditions.js";
import { EditionStoreUnavailable, type EditionJob, type EditionStore, type StoredEdition } from "./EditionQueue.js";

/**
 * Keeps the converted AZW3s in the Google Drive folder "Lumeo Kindle AZW3", in the account that
 * owns the catalog. Supabase keeps only the link (file id, checksum, size, format).
 *
 * It signs in as that account (OAuth refresh token, scope drive.file). With drive.file the
 * worker can only see and change the files it created itself: the folder and the AZW3s. The
 * catalog's EPUBs, the HQs and every other Drive file stay out of its reach. (A service account
 * cannot do this: it has no storage of its own in a personal Drive.)
 *
 * - The folder is found by name (or given by id) and created once when missing.
 * - It is shared as "anyone with the link can read", like the catalog's own files: the Kindle
 *   downloads without a Google login, and only the authenticated download route gives out the
 *   file's address.
 * - A book converted again overwrites its own file (same id). Nothing is ever deleted.
 * - Each upload is checked against Drive's own size and MD5 before the book is marked ready.
 */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export interface DriveOAuthClient { clientId: string; clientSecret: string; }
export interface DriveOAuth extends DriveOAuthClient { refreshToken: string; }

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const TOKEN = "https://oauth2.googleapis.com/token";
const FOLDER = "application/vnd.google-apps.folder";
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;

export class DriveRequestError extends Error {
  public constructor(public readonly status: number, message: string) { super(message); }
}

export class GoogleDriveEditionStore implements EditionStore {
  private token: { value: string; expiresAt: number } | null = null;
  private folder: Promise<string> | null = null;

  public constructor(
    private readonly oauth: DriveOAuth,
    private readonly options: { folderName?: string; folderId?: string } = {},
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!oauth.clientId || !oauth.clientSecret || !oauth.refreshToken) throw new Error("KINDLE_DRIVE_CLIENT_ID, KINDLE_DRIVE_CLIENT_SECRET e KINDLE_DRIVE_REFRESH_TOKEN são obrigatórios (rode npm run worker:kindle:drive-auth).");
    if (options.folderId && !DRIVE_ID.test(options.folderId)) throw new Error("KINDLE_DRIVE_FOLDER_ID não é um id de pasta do Drive.");
  }

  /** The output folder's id, found or created on first use (and shared by link). */
  public folderId(): Promise<string> {
    this.folder ??= this.unavailableOnFailure(() => this.findOrCreateFolder()).catch((error: unknown) => { this.folder = null; throw error; });
    return this.folder;
  }

  public async save(job: EditionJob, file: { name: string; bytes: Uint8Array; sha256: string }): Promise<StoredEdition> {
    const folderId = await this.folderId();
    const existing = await this.unavailableOnFailure(() => this.existingFile(job, folderId));
    const metadata = {
      name: file.name, mimeType: KINDLE_FILE_TYPES.azw3,
      description: "Versão Kindle (AZW3) gerada pelo Lumeo a partir do EPUB do catálogo. O EPUB original continua na pasta do catálogo.",
      // 124 bytes per key+value: ids and the hex checksum fit.
      appProperties: { lumeoBookId: job.bookId, lumeoEpubFileId: job.epubDriveFileId, lumeoSha256: file.sha256 },
    };
    const fields = "id,size,md5Checksum,trashed";
    const session = await this.unavailableOnFailure(() => this.request(
      existing ? `${UPLOAD}/${existing}?uploadType=resumable&supportsAllDrives=true&fields=${fields}` : `${UPLOAD}?uploadType=resumable&supportsAllDrives=true&fields=${fields}`,
      { method: existing ? "PATCH" : "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": KINDLE_FILE_TYPES.azw3, "X-Upload-Content-Length": String(file.bytes.length) },
        body: JSON.stringify(existing ? metadata : { ...metadata, parents: [folderId] }) },
    ));
    const location = session.headers.get("location");
    if (!location?.startsWith("https://")) throw new EditionStoreUnavailable("O Drive não abriu a sessão de envio.");
    const uploaded = await this.unavailableOnFailure(async () => (await this.request(location, { method: "PUT", headers: { "Content-Type": KINDLE_FILE_TYPES.azw3 }, body: file.bytes as Uint8Array<ArrayBuffer> })).json() as Promise<{ id?: string; size?: string; md5Checksum?: string; trashed?: boolean }>);
    const md5 = createHash("md5").update(file.bytes).digest("hex");
    if (!uploaded.id || !DRIVE_ID.test(uploaded.id)) throw new Error("O Drive não devolveu o id do arquivo enviado.");
    if (Number(uploaded.size) !== file.bytes.length || uploaded.md5Checksum !== md5) throw new Error(`O arquivo no Drive não confere com o convertido (tamanho ${uploaded.size ?? "?"} de ${file.bytes.length}, md5 ${uploaded.md5Checksum ?? "?"}).`);
    await this.unavailableOnFailure(() => this.shareByLink(uploaded.id!));
    return { driveFileId: uploaded.id, size: file.bytes.length, md5 };
  }

  /** The book's file from an earlier conversion (by the id on record, or by its tag in the
   *  folder, e.g. after an upload whose record was never written): overwritten, not duplicated. */
  private async existingFile(job: EditionJob, folderId: string): Promise<string | null> {
    if (job.driveFileId && DRIVE_ID.test(job.driveFileId)) {
      const response = await this.request(`${API}/${job.driveFileId}?fields=id,trashed,parents&supportsAllDrives=true`, {}, [404]);
      if (response.ok) {
        const file = await response.json() as { id: string; trashed?: boolean; parents?: string[] };
        if (!file.trashed && file.parents?.includes(folderId)) return file.id;
      }
    }
    const q = `'${folderId}' in parents and trashed = false and appProperties has { key='lumeoBookId' and value='${quote(job.bookId)}' }`;
    const found = await (await this.request(`${API}?${new URLSearchParams({ q, fields: "files(id)", orderBy: "createdTime", pageSize: "5", spaces: "drive" })}`)).json() as { files?: Array<{ id: string }> };
    return found.files?.[0]?.id ?? null;
  }

  private async findOrCreateFolder(): Promise<string> {
    if (this.options.folderId) {
      const folder = await (await this.request(`${API}/${this.options.folderId}?fields=id,mimeType,trashed&supportsAllDrives=true`)).json() as { id: string; mimeType: string; trashed?: boolean };
      if (folder.mimeType !== FOLDER || folder.trashed) throw new Error("KINDLE_DRIVE_FOLDER_ID não é uma pasta ativa do Drive.");
      await this.shareByLink(folder.id);
      return folder.id;
    }
    const name = this.options.folderName?.trim() || KINDLE_DRIVE_FOLDER_NAME;
    const q = `name = '${quote(name)}' and mimeType = '${FOLDER}' and trashed = false and 'root' in parents`;
    const found = await (await this.request(`${API}?${new URLSearchParams({ q, fields: "files(id)", orderBy: "createdTime", pageSize: "5", spaces: "drive" })}`)).json() as { files?: Array<{ id: string }> };
    let id = found.files?.[0]?.id;
    if (!id) {
      const created = await (await this.request(`${API}?fields=id`, { method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ name, mimeType: FOLDER, description: "Livros do catálogo Lumeo convertidos para Kindle (AZW3). Gerada pelo worker de conversão; os EPUBs originais ficam nas pastas do catálogo." }) })).json() as { id?: string };
      if (!created.id) throw new Error("O Drive não criou a pasta de saída.");
      id = created.id;
    }
    await this.shareByLink(id);
    return id;
  }

  /** "Anyone with the link can read", once (a file inside the folder inherits it). */
  private async shareByLink(fileId: string): Promise<void> {
    const listed = await (await this.request(`${API}/${fileId}/permissions?fields=permissions(type,role)&supportsAllDrives=true`)).json() as { permissions?: Array<{ type: string; role: string }> };
    if (listed.permissions?.some((permission) => permission.type === "anyone")) return;
    await this.request(`${API}/${fileId}/permissions?fields=id&supportsAllDrives=true`, { method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ type: "anyone", role: "reader", allowFileDiscovery: false }) });
  }

  /** An authorized Drive call. Statuses in `allowed` come back to the caller; other errors throw. */
  private async request(url: string, init: RequestInit = {}, allowed: readonly number[] = [], retried = false): Promise<Response> {
    const response = await this.fetcher(url, { ...init, headers: { ...init.headers as Record<string, string>, Authorization: `Bearer ${await this.accessToken()}` }, signal: AbortSignal.timeout(300_000) });
    if (response.status === 401 && !retried) { this.token = null; return this.request(url, init, allowed, true); }
    if (response.ok || allowed.includes(response.status)) return response;
    throw new DriveRequestError(response.status, `Drive ${response.status}: ${await driveMessage(response)}`);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const response = await this.fetcher(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(30_000),
      body: new URLSearchParams({ client_id: this.oauth.clientId, client_secret: this.oauth.clientSecret, refresh_token: this.oauth.refreshToken, grant_type: "refresh_token" }) });
    const data = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
    if (!response.ok || !data.access_token) {
      throw new EditionStoreUnavailable(data.error === "invalid_grant"
        ? "O Google recusou o login do worker no Drive (autorização revogada ou expirada). Rode npm run worker:kindle:drive-auth de novo."
        : `O Google não deu acesso ao Drive (${response.status} ${data.error ?? ""}).`.trim());
    }
    this.token = { value: data.access_token, expiresAt: Date.now() + Math.max(60, data.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  /** Every failure is "Drive unavailable" except a request the Drive refused (400): that one is
   *  the book's (a name or data it does not take), counted as one of its attempts. */
  private async unavailableOnFailure<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof EditionStoreUnavailable || (error instanceof DriveRequestError && error.status === 400)) throw error;
      throw new EditionStoreUnavailable(error instanceof Error ? error.message : String(error));
    }
  }
}

const quote = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function driveMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try { const parsed = JSON.parse(text) as { error?: { message?: string; errors?: Array<{ reason?: string }> } }; return [parsed.error?.errors?.[0]?.reason, parsed.error?.message].filter(Boolean).join(" - ").slice(0, 300) || text.slice(0, 300); }
  catch { return text.slice(0, 300); }
}
