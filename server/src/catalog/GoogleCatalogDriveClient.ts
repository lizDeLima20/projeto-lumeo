import { createHash, createSign } from "node:crypto";
import { ApiError } from "../errors/ApiError.js";
import type { CatalogFormat, CatalogSourceAudit } from "./types.js";
import { GoogleDrivePublicUrlResolver } from "./GoogleDrivePublicUrlResolver.js";

interface ServiceAccount { type?: string; project_id?: string; client_email: string; private_key: string; token_uri?: string; }
interface DriveFile { id: string; name: string; mimeType: string; size?: string; modifiedTime: string; resourceKey?: string; shortcutDetails?: { targetId?: string; targetMimeType?: string }; }
export interface CatalogDriveFile { id: string; name: string; format: CatalogFormat; mimeType: string; size: number | null; modifiedAt: string; resourceKey?: string; }
export interface CatalogDriveListing { books: readonly CatalogDriveFile[]; audit: CatalogSourceAudit; }

type CredentialInputFormat = "json_object" | "quoted_json" | "base64" | "unknown" | "empty";
type CredentialParseReason = "invalid_json_syntax" | "unexpected_wrapping" | "base64_decode_failed" | "empty_value" | "unsupported_format";
interface CredentialEnvelope {
  value: string;
  leadingWhitespace: boolean;
  bom: boolean;
  outerQuote: boolean;
  doubleEncoded: boolean;
  base64: boolean;
  unexpectedPrefix: boolean;
  unexpectedSuffix: boolean;
}

/** Deliberately carries only a stable, safe category: never parser output or credential content. */
class CredentialInputError extends Error {
  public constructor(public readonly reason: CredentialParseReason) { super(reason); }
}

/** Recursive server-only Drive indexer. It stores metadata only, never book bytes. */
export class GoogleCatalogDriveClient {
  private token: { value: string; expiresAt: number } | null = null;
  private folderAccessLogged = false;
  private readonly credentials: ServiceAccount;
  public constructor(rawCredentials: string, private readonly folderId: string, private readonly maxFileBytes: number, private readonly fetcher: typeof fetch = fetch) {
    // This must precede every normalizer/parser. It reports positional data
    // only, allowing production diagnosis without exposing a credential byte.
    this.log("CATALOG_SERVICE_ACCOUNT_SHAPE", GoogleCatalogDriveClient.describeRawShape(rawCredentials));
    this.log("CATALOG_SERVICE_ACCOUNT_INPUT", GoogleCatalogDriveClient.describeEnvironmentValue(rawCredentials));
    this.credentials = GoogleCatalogDriveClient.parseCredentials(rawCredentials);
    if (!folderId.trim() || !/^[A-Za-z0-9_-]{10,}$/.test(folderId)) throw new ApiError(503, "CATALOG_FOLDER_INVALID", "A pasta do catálogo não está configurada corretamente.");
    this.log("CATALOG_SERVICE_ACCOUNT_CONFIG", { stage: "accepted" });
  }
  public async listBooks(): Promise<readonly CatalogDriveFile[]> { return (await this.listCatalog()).books; }
  public async listCatalog(): Promise<CatalogDriveListing> {
    const audit: CatalogSourceAudit = { foldersVisited: 0, pagesFetched: 0, rawItemsFound: 0, filesSeen: 0, supportedFiles: 0, pdfCount: 0, epubCount: 0, shortcutCount: 0, unsupportedCount: 0, duplicates: 0, parseFailures: 0, finalCatalogCount: 0 };
    const books = new Map<string, CatalogDriveFile>(); await this.visitFolder(this.folderId, new Set(), books, audit); audit.finalCatalogCount = books.size;
    this.log("CATALOG_DRIVE_TOTAL_DISCOVERED", { rawItemsFound: audit.rawItemsFound, finalCatalogCount: audit.finalCatalogCount });
    this.log("CATALOG_SOURCE_TOTAL_FILES", { count: audit.rawItemsFound }); this.log("CATALOG_SOURCE_PAGES_FETCHED", { count: audit.pagesFetched }); this.log("CATALOG_SOURCE_FILES_SEEN", { count: audit.filesSeen });
    this.log("CATALOG_SOURCE_SUPPORTED_FILES", { count: audit.supportedFiles, pdfCount: audit.pdfCount, epubCount: audit.epubCount }); this.log("CATALOG_SOURCE_UNSUPPORTED_FILES", { count: audit.unsupportedCount });
    this.log("CATALOG_SOURCE_DUPLICATES", { count: audit.duplicates }); this.log("CATALOG_SOURCE_PARSE_FAILURES", { count: audit.parseFailures }); this.log("CATALOG_SOURCE_FINAL_BOOKS", { count: audit.finalCatalogCount, foldersVisited: audit.foldersVisited, shortcutCount: audit.shortcutCount });
    this.log("CATALOG_CATALOG_FLOW", { stage: "total_books", outcome: "ok", count: audit.finalCatalogCount });
    return { books: [...books.values()], audit };
  }
  public async hashAndValidate(file: CatalogDriveFile): Promise<string> {
    this.assertSize(file.size); const response = await this.media(file.id); const reader = response.body?.getReader(); if (!reader) throw new ApiError(503, "CATALOG_SOURCE_UNAVAILABLE", "Não foi possível ler o arquivo do catálogo.");
    const hash = createHash("sha256"); let prefix: Uint8Array<ArrayBufferLike> = new Uint8Array(); let received = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; if (value) { received += value.byteLength; if (received > this.maxFileBytes) throw new ApiError(413, "CATALOG_FILE_TOO_LARGE", "Um arquivo do catálogo ultrapassa o limite permitido."); hash.update(value); if (prefix.length < 8) prefix = this.concatPrefix(prefix, value); } }
    this.assertSignature(file.format, prefix); return hash.digest("hex");
  }
  /** A genre folder's catalog.json through the Drive API; null when the folder has none. */
  public async readCatalogJson(folderId = this.folderId): Promise<unknown | null> {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", `'${folderId.replace(/'/g, "\\'")}' in parents and name = 'catalog.json' and trashed = false`);
    url.searchParams.set("fields", "files(id,name)"); url.searchParams.set("pageSize", "10"); url.searchParams.set("supportsAllDrives", "true"); url.searchParams.set("includeItemsFromAllDrives", "true");
    const listing = await this.authorized(url); if (!listing.ok) throw this.driveError(listing.status);
    const file = ((await listing.json()) as { files?: Array<{ id: string }> }).files?.[0];
    if (!file) return null;
    const response = await this.media(file.id);
    try { return await response.json() as unknown; } catch { throw new ApiError(422, "CATALOG_SOURCE_INVALID", "catalog.json não possui JSON válido."); }
  }
  public static publicDownloadUrl(fileId: string): string { return new GoogleDrivePublicUrlResolver().resolve(fileId, "pdf").downloadUrl; }

  private async visitFolder(folderId: string, visited: Set<string>, books: Map<string, CatalogDriveFile>, audit: CatalogSourceAudit): Promise<void> {
    if (visited.has(folderId)) return; visited.add(folderId); audit.foldersVisited++; this.log("CATALOG_FOLDER_VISITED", { folderIndex: audit.foldersVisited });
    let pageToken = "", folderCount = 0;
    do {
      const url = new URL("https://www.googleapis.com/drive/v3/files"); url.searchParams.set("q", `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`);
      url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime,resourceKey,shortcutDetails(targetId,targetMimeType))"); url.searchParams.set("pageSize", "1000"); url.searchParams.set("orderBy", "modifiedTime desc"); url.searchParams.set("supportsAllDrives", "true"); url.searchParams.set("includeItemsFromAllDrives", "true"); if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await this.authorized(url); if (!response.ok) { this.log("CATALOG_CATALOG_FLOW", { stage: "folder_access", outcome: "failed", httpStatus: response.status }); throw this.driveError(response.status); }
      if (!this.folderAccessLogged) { this.folderAccessLogged = true; this.log("CATALOG_CATALOG_FLOW", { stage: "folder_access", outcome: "ok" }); }
      const data = await response.json() as { files?: DriveFile[]; nextPageToken?: string }; const files = data.files ?? [];
      this.log("CATALOG_CATALOG_FLOW", { stage: "drive_api", outcome: "ok", page: audit.pagesFetched + 1 });
      audit.pagesFetched++; audit.rawItemsFound += files.length; folderCount += files.length; this.log("CATALOG_DRIVE_PAGE_FETCHED", { page: audit.pagesFetched, items: files.length, hasNextPage: Boolean(data.nextPageToken) });
      for (const file of files) await this.visitItem(file, visited, books, audit); pageToken = data.nextPageToken ?? "";
    } while (pageToken);
    this.log("CATALOG_FOLDER_FILE_COUNT", { items: folderCount });
  }
  private async visitItem(file: DriveFile, visited: Set<string>, books: Map<string, CatalogDriveFile>, audit: CatalogSourceAudit): Promise<void> {
    audit.filesSeen++; if (file.mimeType === "application/vnd.google-apps.folder") return this.visitFolder(file.id, visited, books, audit);
    if (file.mimeType === "application/vnd.google-apps.shortcut") { audit.shortcutCount++; const targetId = file.shortcutDetails?.targetId, targetMimeType = file.shortcutDetails?.targetMimeType; if (!targetId || !targetMimeType) { audit.parseFailures++; return; } if (targetMimeType === "application/vnd.google-apps.folder") return this.visitFolder(targetId, visited, books, audit); this.addBook({ ...file, id: targetId, mimeType: targetMimeType }, books, audit); return; }
    this.addBook(file, books, audit);
  }
  private addBook(file: DriveFile, books: Map<string, CatalogDriveFile>, audit: CatalogSourceAudit): void {
    const format = this.format(file); if (!format) { audit.unsupportedCount++; return; } audit.supportedFiles++; if (books.has(file.id)) { audit.duplicates++; return; }
    if (format === "pdf") audit.pdfCount++; else audit.epubCount++; books.set(file.id, { id: file.id, name: file.name, format, mimeType: file.mimeType, size: file.size ? Number(file.size) : null, modifiedAt: file.modifiedTime, resourceKey: file.resourceKey });
  }
  private format(file: DriveFile): CatalogFormat | null { const ext = file.name.split(".").pop()?.toLowerCase(); return ext === "pdf" || file.mimeType === "application/pdf" ? "pdf" : ext === "epub" || file.mimeType === "application/epub+zip" ? "epub" : null; }
  private async authorized(url: URL): Promise<Response> { return this.fetcher(url, { headers: { Authorization: `Bearer ${await this.accessToken()}` } }); }
  private async media(fileId: string): Promise<Response> { const response = await this.authorized(new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`)); if (!response.ok) throw this.driveError(response.status); return response; }
  private async accessToken(): Promise<string> { if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value; const now = Math.floor(Date.now() / 1000), header = this.encode({ alg: "RS256", typ: "JWT" }), payload = this.encode({ iss: this.credentials.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: this.credentials.token_uri ?? "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }); let signature: string; try { const signer = createSign("RSA-SHA256"); signer.update(`${header}.${payload}`); signer.end(); signature = signer.sign(this.credentials.private_key, "base64url"); } catch { this.log("CATALOG_SERVICE_ACCOUNT_AUTH", { stage: "google_auth", outcome: "signing_failed" }); throw new ApiError(503, "CATALOG_PRIVATE_KEY_INVALID", "A chave privada da conta de serviço é inválida."); } const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${payload}.${signature}` }); const response = await this.fetcher(this.credentials.token_uri ?? "https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }); if (!response.ok) { this.log("CATALOG_SERVICE_ACCOUNT_AUTH", { stage: "google_auth", outcome: "rejected", httpStatus: response.status }); throw new ApiError(503, "CATALOG_GOOGLE_AUTH_FAILED", "O Google recusou a autenticação da conta de serviço."); } const data = await response.json() as { access_token?: string; expires_in?: number }; if (!data.access_token) { this.log("CATALOG_SERVICE_ACCOUNT_AUTH", { stage: "google_auth", outcome: "invalid_response" }); throw new ApiError(503, "CATALOG_GOOGLE_AUTH_INVALID_RESPONSE", "O Google não retornou uma credencial de acesso válida."); } this.log("CATALOG_SERVICE_ACCOUNT_AUTH", { stage: "google_auth", outcome: "ok", httpStatus: response.status }); this.token = { value: data.access_token, expiresAt: Date.now() + Math.max(60, data.expires_in ?? 3600) * 1000 }; return this.token.value; }
  private assertSize(size: number | null): void { if (size !== null && (!Number.isFinite(size) || size <= 0 || size > this.maxFileBytes)) throw new ApiError(413, "CATALOG_FILE_TOO_LARGE", "Um arquivo do catálogo ultrapassa o limite permitido."); }
  private assertSignature(format: CatalogFormat, prefix: Uint8Array<ArrayBufferLike>): void { const text = new TextDecoder().decode(prefix); if (!(format === "pdf" ? text.startsWith("%PDF-") : prefix[0] === 0x50 && prefix[1] === 0x4b)) throw new ApiError(422, "CATALOG_FILE_INVALID", "Um arquivo do catálogo não possui um formato válido."); }
  private concatPrefix(previous: Uint8Array<ArrayBufferLike>, next: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> { const value = new Uint8Array(Math.min(8, previous.length + next.length)); value.set(previous.slice(0, value.length)); value.set(next.slice(0, value.length - previous.length), previous.length); return value; }
  private driveError(status: number): ApiError { return status === 401 ? new ApiError(503, "CATALOG_DRIVE_UNAUTHORIZED", "A conta de serviço não foi autorizada pelo Google Drive.") : status === 403 ? new ApiError(503, "CATALOG_DRIVE_FORBIDDEN", "A conta de serviço não possui acesso à pasta do catálogo.") : status === 404 ? new ApiError(404, "CATALOG_FOLDER_NOT_FOUND", "A pasta ou arquivo do catálogo não foi encontrado ou compartilhado com a conta de serviço.") : new ApiError(503, "CATALOG_SOURCE_UNAVAILABLE", "O armazenamento do catálogo não está disponível."); }
  private encode(value: object): string { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
  private log(event: string, details: Record<string, unknown>): void { console.info(JSON.stringify({ event, ...details })); }
  private static parseCredentials(raw: string): ServiceAccount {
    const envelope = GoogleCatalogDriveClient.normalizeEnvelope(raw);
    const source = envelope.value;
    if (!source) {
      GoogleCatalogDriveClient.logValidationFailure("JSON.parse", "empty_value");
      throw new ApiError(503, "CATALOG_SERVICE_ACCOUNT_MISSING", "A conta de serviço do catálogo não está configurada.");
    }

    let value: unknown;
    try {
      const decoded = GoogleCatalogDriveClient.decodeEnvironmentValue(source);
      value = GoogleCatalogDriveClient.parseJsonValue(decoded);
    } catch (error) {
      const reason = error instanceof CredentialInputError ? error.reason : "invalid_json_syntax";
      GoogleCatalogDriveClient.logValidationFailure("JSON.parse", reason);
      throw new ApiError(503, "CATALOG_SERVICE_ACCOUNT_JSON_INVALID", "O JSON da conta de serviço é inválido.");
    }
    GoogleCatalogDriveClient.logValidationSuccess("JSON.parse");

    if (!GoogleCatalogDriveClient.isServiceAccount(value)) {
      GoogleCatalogDriveClient.logValidationFailure("required_fields");
      throw new ApiError(503, "CATALOG_SERVICE_ACCOUNT_FIELDS_INVALID", "O JSON da conta de serviço não possui os campos obrigatórios.");
    }
    GoogleCatalogDriveClient.logValidationSuccess("required_fields");

    const privateKey = value.private_key.replace(/\\n/g, "\n").replace(/\r\n?/g, "\n");
    if (!privateKey.includes("-----BEGIN PRIVATE KEY-----") || !privateKey.includes("-----END PRIVATE KEY-----")) {
      GoogleCatalogDriveClient.logValidationFailure("private_key_format");
      throw new ApiError(503, "CATALOG_PRIVATE_KEY_INVALID", "A chave privada da conta de serviço não possui um PEM válido.");
    }
    GoogleCatalogDriveClient.logValidationSuccess("private_key_format");
    return { ...value, private_key: privateKey };
  }

  /** Vercel may preserve JSON, stringify it once more, or provide base64 JSON. */
  private static decodeEnvironmentValue(source: string): string {
    if ((source.startsWith("'") && !source.endsWith("'"))
      || (!source.startsWith("'") && source.endsWith("'"))) {
      throw new CredentialInputError("unexpected_wrapping");
    }
    const format = GoogleCatalogDriveClient.inputFormat(source);
    if (format === "empty") throw new CredentialInputError("empty_value");
    if (format === "json_object" || format === "quoted_json") return GoogleCatalogDriveClient.escapeLiteralPrivateKeyNewlines(source);
    if (format !== "base64") throw new CredentialInputError("unsupported_format");
    try {
      const decoded = Buffer.from(source, "base64").toString("utf8");
      if (!decoded.trim() || !["{", "\""].includes(decoded.trim().charAt(0))) throw new CredentialInputError("base64_decode_failed");
      return GoogleCatalogDriveClient.escapeLiteralPrivateKeyNewlines(decoded);
    } catch (error) {
      if (error instanceof CredentialInputError) throw error;
      throw new CredentialInputError("base64_decode_failed");
    }
  }

  private static parseJsonValue(source: string): unknown {
    const first = JSON.parse(GoogleCatalogDriveClient.escapeLiteralPrivateKeyNewlines(source)) as unknown;
    return typeof first === "string" ? JSON.parse(GoogleCatalogDriveClient.escapeLiteralPrivateKeyNewlines(first)) as unknown : first;
  }

  /** Repairs only physical line breaks inside private_key; JSON whitespace elsewhere is untouched. */
  private static escapeLiteralPrivateKeyNewlines(source: string): string {
    return source.replace(/("private_key"\s*:\s*")([\s\S]*?)("(?=\s*(?:,|\})))/u, (_whole, start: string, body: string, end: string) => `${start}${body.replace(/\r?\n/g, "\\n")}${end}`);
  }

  private static isServiceAccount(value: unknown): value is ServiceAccount {
    if (!value || typeof value !== "object") return false;
    const account = value as Partial<ServiceAccount>;
    return account.type === "service_account" && typeof account.project_id === "string" && Boolean(account.project_id)
      && typeof account.client_email === "string" && Boolean(account.client_email)
      && typeof account.private_key === "string" && Boolean(account.private_key);
  }

  private static logValidationFailure(stage: "JSON.parse" | "required_fields" | "private_key_format", reason?: CredentialParseReason): void {
    console.info(JSON.stringify({ event: "CATALOG_SERVICE_ACCOUNT_VALIDATION", stage, outcome: "failed", ...(reason ? { reason } : {}) }));
  }

  private static logValidationSuccess(stage: "JSON.parse" | "required_fields" | "private_key_format"): void {
    console.info(JSON.stringify({ event: "CATALOG_SERVICE_ACCOUNT_VALIDATION", stage, outcome: "ok" }));
  }

  private static describeEnvironmentValue(raw: string): Record<string, unknown> {
    const envelope = GoogleCatalogDriveClient.normalizeEnvelope(raw);
    const source = GoogleCatalogDriveClient.trimLeadingUnicodeMarkers(raw).trim();
    const value = envelope.value;
    return {
      present: Boolean(source),
      length: source.length,
      format: GoogleCatalogDriveClient.inputFormat(value),
      firstCharType: GoogleCatalogDriveClient.characterType(source.charAt(0), true),
      lastCharType: GoogleCatalogDriveClient.characterType(source.charAt(source.length - 1), false),
      leadingWhitespace: envelope.leadingWhitespace,
      bom: envelope.bom,
      outerQuote: envelope.outerQuote,
      doubleEncoded: envelope.doubleEncoded,
      base64: envelope.base64,
      unexpectedPrefix: envelope.unexpectedPrefix,
      unexpectedSuffix: envelope.unexpectedSuffix,
    };
  }

  /** Positional-only raw-input diagnostics. No character or substring is ever logged. */
  private static describeRawShape(raw: string): Record<string, unknown> {
    const trimmed = raw.trim();
    const leadingWhitespaceCount = (raw.match(/^\s*/u)?.[0].length) ?? 0;
    const trailingWhitespaceCount = (raw.match(/\s*$/u)?.[0].length) ?? 0;
    const firstOpeningBraceIndex = raw.indexOf("{");
    const lastClosingBraceIndex = raw.lastIndexOf("}");
    const hasObject = firstOpeningBraceIndex >= 0 && lastClosingBraceIndex >= firstOpeningBraceIndex;
    const first = (index: number): number | null => index >= 0 && index < raw.length ? raw.charCodeAt(index) : null;
    const meaningfulEnd = raw.length - trailingWhitespaceCount - 1;
    return {
      length: raw.length,
      trimmedLength: trimmed.length,
      leadingWhitespaceCount,
      trailingWhitespaceCount,
      hasBom: /^[\s]*[\uFEFF]/u.test(raw),
      firstCharCode: first(0),
      secondCharCode: first(1),
      thirdCharCode: first(2),
      lastCharCode: first(raw.length - 1),
      secondLastCharCode: first(raw.length - 2),
      startsWithBrace: trimmed.startsWith("{"),
      endsWithBrace: trimmed.endsWith("}"),
      startsWithQuote: trimmed.startsWith("\"") || trimmed.startsWith("'"),
      endsWithQuote: trimmed.endsWith("\"") || trimmed.endsWith("'"),
      startsWithBase64JsonSignature: /^(?:eyJ|ew)/u.test(trimmed),
      containsJsonObjectAfterPrefix: hasObject && firstOpeningBraceIndex > leadingWhitespaceCount,
      jsonObjectStartIndex: hasObject ? firstOpeningBraceIndex : null,
      containsJsonObjectBeforeSuffix: hasObject && lastClosingBraceIndex < meaningfulEnd,
      firstOpeningBraceIndex: hasObject ? firstOpeningBraceIndex : null,
      lastClosingBraceIndex: hasObject ? lastClosingBraceIndex : null,
      charactersBeforeOpeningBrace: hasObject ? firstOpeningBraceIndex : null,
      charactersAfterClosingBrace: hasObject ? raw.length - lastClosingBraceIndex - 1 : null,
    };
  }

  /**
   * Vercel expects a value, while terminals and copy/paste workflows often
   * include `export NAME = 'value'`. Remove only that outer transport layer;
   * the JSON payload and private key are never rewritten here.
   */
  private static normalizeEnvelope(raw: string): CredentialEnvelope {
    const leadingWhitespace = /^\s/u.test(raw);
    // String.trimStart() considers U+FEFF whitespace, so use only ordinary
    // transport whitespace here in order to retain a safe BOM diagnostic.
    const beforeMarker = raw.replace(/^[ \t\r\n\f\v]+/u, "");
    const bom = /^[\uFEFF\u200B\u2060]/u.test(beforeMarker);
    let value = GoogleCatalogDriveClient.trimLeadingUnicodeMarkers(beforeMarker).trim();
    const assignment = /^(?:export\s+)?GOOGLE_CATALOG_SERVICE_ACCOUNT_JSON\s*=\s*/u.exec(value);
    const unexpectedPrefix = Boolean(assignment);
    if (assignment) value = value.slice(assignment[0].length).trim();

    const startsSingleQuote = value.startsWith("'");
    const endsSingleQuote = value.endsWith("'");
    const outerQuote = startsSingleQuote && endsSingleQuote && value.length >= 2;
    const unexpectedSuffix = startsSingleQuote !== endsSingleQuote;
    if (outerQuote) value = value.slice(1, -1).trim();

    const format = GoogleCatalogDriveClient.inputFormat(value);
    return {
      value,
      leadingWhitespace,
      bom,
      outerQuote,
      doubleEncoded: format === "quoted_json",
      base64: format === "base64",
      unexpectedPrefix,
      unexpectedSuffix,
    };
  }

  private static trimLeadingUnicodeMarkers(value: string): string { return value.replace(/^[\uFEFF\u200B\u2060]+/u, ""); }

  private static inputFormat(value: string): CredentialInputFormat {
    const source = value.trim();
    if (!source) return "empty";
    if (source.startsWith("{")) return "json_object";
    if (source.startsWith("\"")) return "quoted_json";
    return GoogleCatalogDriveClient.isBase64(source) ? "base64" : "unknown";
  }

  private static isBase64(value: string): boolean {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    return normalized.length >= 4 && normalized.length % 4 !== 1 && /^[A-Za-z0-9+/]*={0,2}$/u.test(normalized);
  }

  private static characterType(character: string, first: boolean): "brace" | "quote" | "other" {
    if (first ? character === "{" : character === "}") return "brace";
    if (character === "\"" || character === "'") return "quote";
    return "other";
  }
}
