import { createHash, createSign } from "node:crypto";
import { ApiError } from "../errors/ApiError.js";
import type { CatalogFormat } from "./types.js";

interface ServiceAccount { client_email: string; private_key: string; token_uri?: string; }
interface DriveFile { id: string; name: string; mimeType: string; size?: string; modifiedTime: string; }
export interface CatalogDriveFile { id: string; name: string; format: CatalogFormat; mimeType: string; size: number | null; modifiedAt: string; }

/**
 * Minimal server-only Google Drive client. It authenticates with a service account
 * shared with the catalog folder; no token, key or Drive URL reaches the browser.
 */
export class GoogleCatalogDriveClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly credentials: ServiceAccount;
  public constructor(rawCredentials: string, private readonly folderId: string, private readonly maxFileBytes: number) {
    this.credentials = GoogleCatalogDriveClient.parseCredentials(rawCredentials);
    if (!folderId.trim()) throw new ApiError(503, "CATALOG_NOT_CONFIGURED", "O catálogo ainda não está configurado no servidor.");
  }
  public async listBooks(): Promise<readonly CatalogDriveFile[]> {
    const token = await this.accessToken(); const fields = "nextPageToken,files(id,name,mimeType,size,modifiedTime)";
    const files: DriveFile[] = []; let pageToken = "";
    do {
      const query = new URL("https://www.googleapis.com/drive/v3/files");
      query.searchParams.set("q", `'${this.folderId.replace(/'/g, "\\'")}' in parents and trashed = false`);
      query.searchParams.set("fields", fields); query.searchParams.set("pageSize", "100"); query.searchParams.set("orderBy", "modifiedTime desc");
      if (pageToken) query.searchParams.set("pageToken", pageToken);
      const response = await fetch(query, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw this.driveError(response.status);
      const data = await response.json() as { files?: DriveFile[]; nextPageToken?: string };
      files.push(...(data.files ?? [])); pageToken = data.nextPageToken ?? "";
    } while (pageToken);
    return files.map((file) => this.toCatalogFile(file)).filter((file): file is CatalogDriveFile => file !== null);
  }
  public async hashAndValidate(file: CatalogDriveFile): Promise<string> {
    this.assertSize(file.size);
    const response = await this.media(file.id);
    const reader = response.body?.getReader(); if (!reader) throw new ApiError(503, "CATALOG_SOURCE_UNAVAILABLE", "Não foi possível ler o arquivo do catálogo.");
    const hash = createHash("sha256"); let prefix: Uint8Array<ArrayBufferLike> = new Uint8Array(); let received = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      if (value) { received += value.byteLength; if (received > this.maxFileBytes) throw new ApiError(413, "CATALOG_FILE_TOO_LARGE", "Um arquivo do catálogo ultrapassa o limite permitido."); hash.update(value); if (prefix.length < 8) prefix = this.concatPrefix(prefix, value); }
    }
    this.assertSignature(file.format, prefix); return hash.digest("hex");
  }
  /** Public files are downloaded browser-to-Drive, never through the BFF. */
  public static publicDownloadUrl(fileId: string): string {
    if (!/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) throw new ApiError(422, "CATALOG_FILE_INVALID", "Identificador de arquivo do catálogo inválido.");
    const url = new URL("https://drive.usercontent.google.com/download");
    url.searchParams.set("id", fileId);
    url.searchParams.set("export", "download");
    url.searchParams.set("confirm", "t");
    return url.toString();
  }
  private async media(fileId: string): Promise<Response> {
    const token = await this.accessToken(); const response = await fetch(this.fileUrl(fileId), { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw this.driveError(response.status); return response;
  }
  private fileUrl(fileId: string): string { return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`; }
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const now = Math.floor(Date.now() / 1000), header = this.encode({ alg: "RS256", typ: "JWT" });
    const payload = this.encode({ iss: this.credentials.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: this.credentials.token_uri ?? "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
    const signer = createSign("RSA-SHA256"); signer.update(`${header}.${payload}`); signer.end(); const assertion = `${header}.${payload}.${signer.sign(this.credentials.private_key, "base64url")}`;
    const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
    const response = await fetch(this.credentials.token_uri ?? "https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (!response.ok) throw new ApiError(503, "CATALOG_SOURCE_UNAVAILABLE", "Não foi possível autenticar no armazenamento do catálogo.");
    const data = await response.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new ApiError(503, "CATALOG_SOURCE_UNAVAILABLE", "Não foi possível autenticar no armazenamento do catálogo.");
    this.token = { value: data.access_token, expiresAt: Date.now() + Math.max(60, data.expires_in ?? 3600) * 1000 }; return this.token.value;
  }
  private toCatalogFile(file: DriveFile): CatalogDriveFile | null {
    const extension = file.name.split(".").pop()?.toLowerCase(); const format = extension === "pdf" ? "pdf" : extension === "epub" ? "epub" : null;
    if (!format) return null;
    return { id: file.id, name: file.name, format, mimeType: file.mimeType, size: file.size ? Number(file.size) : null, modifiedAt: file.modifiedTime };
  }
  private assertSize(size: number | null): void { if (size !== null && (!Number.isFinite(size) || size <= 0 || size > this.maxFileBytes)) throw new ApiError(413, "CATALOG_FILE_TOO_LARGE", "Um arquivo do catálogo ultrapassa o limite permitido."); }
  private assertSignature(format: CatalogFormat, prefix: Uint8Array<ArrayBufferLike>): void {
    const signature = new TextDecoder().decode(prefix);
    const valid = format === "pdf" ? signature.startsWith("%PDF-") : prefix[0] === 0x50 && prefix[1] === 0x4b;
    if (!valid) throw new ApiError(422, "CATALOG_FILE_INVALID", "Um arquivo do catálogo não possui um formato válido.");
  }
  private concatPrefix(previous: Uint8Array<ArrayBufferLike>, next: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> { const combined = new Uint8Array(Math.min(8, previous.length + next.length)); combined.set(previous.slice(0, combined.length)); combined.set(next.slice(0, combined.length - previous.length), previous.length); return combined; }
  private driveError(status: number): ApiError { return status === 404 ? new ApiError(404, "CATALOG_FILE_UNAVAILABLE", "O livro não está mais disponível no catálogo.") : status === 401 || status === 403 ? new ApiError(503, "CATALOG_SOURCE_UNAVAILABLE", "O armazenamento do catálogo não está disponível.") : new ApiError(503, "CATALOG_SOURCE_UNAVAILABLE", "O armazenamento do catálogo não está disponível."); }
  private encode(value: object): string { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
  private static parseCredentials(raw: string): ServiceAccount {
    if (!raw.trim()) throw new ApiError(503, "CATALOG_NOT_CONFIGURED", "O catálogo ainda não está configurado no servidor.");
    try {
      const decoded = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"); const value = JSON.parse(decoded) as ServiceAccount;
      if (!value.client_email || !value.private_key) throw new Error("missing fields"); return value;
    } catch { throw new ApiError(503, "CATALOG_NOT_CONFIGURED", "O catálogo ainda não está configurado no servidor."); }
  }
}
