import { ApiError } from "../errors/ApiError.js";
import { AuthMiddleware } from "../middleware/requireAuth.js";
import type { ProfileStore } from "../repositories/ProfileRepository.js";
import type { AuthProvider } from "../services/AuthService.js";
import { DeviceService } from "../services/DeviceService.js";
import { LicenseService } from "../services/LicenseService.js";
import type { ApiResponse, AuthenticatedRequest } from "../types/http.js";
import { RequestValidator } from "../validation/RequestValidator.js";
import { CatalogApplicationService } from "../catalog/CatalogApplicationService.js";
import type { PersistedGenre, PersistedLibraryBook, PersistedPreferences, UserPersistenceStore } from "../repositories/UserPersistenceRepository.js";

export class ApiController {
  private readonly validator = new RequestValidator();
  public constructor(
    private readonly auth: AuthProvider,
    private readonly authMiddleware: AuthMiddleware,
    private readonly devices: DeviceService,
    private readonly licenses: LicenseService,
    private readonly profiles: ProfileStore,
    private readonly catalog?: CatalogApplicationService,
    private readonly persistence?: UserPersistenceStore,
  ) {}

  public async handle(request: AuthenticatedRequest, response: ApiResponse, path: string): Promise<void> {
    try {
      if (request.method === "GET" && path === "/api/health") return this.json(response, 200, { status: "ok" });
      if (request.method === "POST" && path === "/api/auth/signup") return await this.signup(request, response);
      if (request.method === "POST" && path === "/api/auth/login") return await this.login(request, response);
      if (request.method === "POST" && path === "/api/auth/google") return await this.google(request, response);
      if (request.method === "POST" && path === "/api/auth/refresh") return await this.refresh(request, response);
      await this.authMiddleware.requireAuth(request);
      const user = request.user;
      if (!user) throw new ApiError(401, "AUTH_REQUIRED", "Autenticação necessária.");

      if (request.method === "GET" && path === "/api/me") {
        await this.devices.assertActive(user.id, this.installationId(request));
        const license = await this.licenses.getForUser(user.id);
        return this.json(response, 200, { user, license: { status: license.status } });
      }
      if (request.method === "GET" && path === "/api/user-state") {
        return this.json(response, 200, await this.requiredPersistence().getState(user.id));
      }
      if (request.method === "POST" && path === "/api/user-state/preferences") {
        const body = await this.body(request);
        await this.requiredPersistence().savePreferences(user.id, this.preferences(body.preferences));
        return this.json(response, 200, { ok: true });
      }
      if (request.method === "POST" && path === "/api/user-state/library") {
        const body = await this.body(request);
        const book = await this.requiredPersistence().saveBook(user.id, this.libraryBook(body.book));
        return this.json(response, 200, { ok: true, book });
      }
      if (request.method === "POST" && path === "/api/user-state/library/delete") {
        const body = await this.body(request);
        const bookId = typeof body.bookId === "string" ? body.bookId.trim() : "";
        if (!bookId || bookId.length > 160) throw new ApiError(400, "INVALID_LIBRARY_BOOK", "Livro inválido.");
        await this.requiredPersistence().deleteBook(user.id, bookId);
        return this.json(response, 200, { ok: true });
      }
      if (request.method === "GET" && path === "/api/device") {
        return this.json(response, 200, await this.devices.getState(user.id, this.installationId(request)));
      }
      if (path === "/api/catalog/books" && request.method === "GET") {
        await this.assertCatalogLicense(user.id);
        return this.json(response, 200, await this.requiredCatalog().list(this.catalogQuery(request)));
      }
      if (path === "/api/catalog/admin/status" && request.method === "GET") {
        await this.assertCatalogLicense(user.id);
        return this.json(response, 200, await this.requiredCatalog().adminStatus(user.id));
      }
      const catalogBook = path.match(/^\/api\/catalog\/books\/([^/]+)$/);
      if (catalogBook && request.method === "GET") {
        await this.assertCatalogLicense(user.id);
        return this.json(response, 200, await this.requiredCatalog().get(decodeURIComponent(catalogBook[1]!), this.catalogQuery(request).locale));
      }
      const catalogDownload = path.match(/^\/api\/catalog\/books\/([^/]+)\/download$/);
      if (catalogDownload && request.method === "GET") {
        await this.assertCatalogLicense(user.id);
        return this.json(response, 200, await this.requiredCatalog().download(decodeURIComponent(catalogDownload[1]!), this.catalogQuery(request).locale));
      }
      if (path === "/api/catalog/sync" && request.method === "POST") {
        await this.assertCatalogLicense(user.id);
        return this.json(response, 200, await this.requiredCatalog().sync(user.id));
      }
      if (request.method === "POST" && path === "/api/device/register") {
        const body = await this.body(request);
        return this.json(response, 201, await this.devices.registerFirstDevice(user.id, this.installationId(request), this.string(body.deviceName)));
      }
      if (request.method === "POST" && path === "/api/device/replace") {
        this.auth.requireRecentAuthentication(user);
        const body = await this.body(request);
        return this.json(response, 200, await this.devices.replaceDevice(user.id, this.installationId(request), this.string(body.deviceName)));
      }
      if (request.method === "POST" && path === "/api/device/revoke") {
        await this.devices.revokeCurrent(user.id, this.installationId(request));
        return this.json(response, 200, { status: "revoked" });
      }
      throw new ApiError(404, "NOT_FOUND", "Endpoint não encontrado.");
    } catch (error) {
      const safe = error instanceof ApiError ? error : new ApiError(500, "INTERNAL_ERROR", "Erro interno do servidor.");
      this.json(response, safe.status, { ok: false, code: safe.code, message: safe.message, requestId: response.getHeader("X-Request-Id") });
    }
  }

  private async signup(request: AuthenticatedRequest, response: ApiResponse): Promise<void> {
    const body = await this.body(request);
    this.logAuthStep("signup.body.validated");
    const result = await this.auth.signup(this.validator.email(body.email), this.validator.password(body.password));
    this.logAuthStep("signup.auth.completed", { hasSession: "user" in result });
    if ("user" in result) {
      await this.ensureProfile("signup", result.user.id, result.user.email);
      this.logAuthStep("signup.profile.completed");
    }
    this.logAuthStep("signup.response.sending");
    this.json(response, 201, result);
  }
  private async login(request: AuthenticatedRequest, response: ApiResponse): Promise<void> {
    const body = await this.body(request);
    this.logAuthStep("login.body.validated");
    const result = await this.auth.login(this.validator.email(body.email), this.validator.password(body.password));
    this.logAuthStep("login.auth.completed", {
      hasAccessToken: Boolean(result.accessToken),
      hasRefreshToken: Boolean(result.refreshToken),
      hasUser: Boolean(result.user.id),
      hasEmail: Boolean(result.user.email),
    });
    await this.ensureProfile("login", result.user.id, result.user.email);
    this.logAuthStep("login.profile.completed");
    this.logAuthStep("login.response.sending");
    this.json(response, 200, result);
  }
  private async google(request: AuthenticatedRequest, response: ApiResponse): Promise<void> {
    const body = await this.body(request);
    const result = await this.auth.google(this.validator.token(body.credential), this.validator.nonce(body.nonce));
    this.logAuthStep("google.auth.completed", { hasUser: Boolean(result.user.id), hasEmail: Boolean(result.user.email) });
    await this.ensureProfile("login", result.user.id, result.user.email);
    this.json(response, 200, result);
  }
  private async refresh(request: AuthenticatedRequest, response: ApiResponse): Promise<void> {
    const body = await this.body(request);
    this.json(response, 200, await this.auth.refresh(this.validator.token(body.refreshToken)));
  }
  private installationId(request: AuthenticatedRequest): string {
    const value = request.headers["x-installation-id"];
    return this.validator.installationId(value);
  }
  private async body(request: AuthenticatedRequest): Promise<Record<string, unknown>> {
    // Vercel may have consumed the stream and already parsed JSON.
    if (request.body !== undefined) {
      const raw = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
      if (Buffer.byteLength(raw) > 16_384) throw new ApiError(413, "BODY_TOO_LARGE", "Corpo muito grande.");
      return this.parseBody(raw);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 16_384) throw new ApiError(413, "BODY_TOO_LARGE", "Corpo muito grande.");
        chunks.push(buffer);
      }
    if (chunks.length === 0) return {};
    return this.parseBody(Buffer.concat(chunks).toString("utf8"));
  }
  private parseBody(raw: string): Record<string, unknown> {
    try {
      const body: unknown = JSON.parse(raw);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid body");
      return body as Record<string, unknown>;
    }
    catch { throw new ApiError(400, "INVALID_JSON", "JSON inválido."); }
  }
  private string(value: unknown): string {
    return this.validator.deviceName(value);
  }
  private json(response: ApiResponse, status: number, data: unknown): void {
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(data));
  }
  private requiredCatalog(): CatalogApplicationService {
    if (!this.catalog) throw new ApiError(503, "CATALOG_NOT_CONFIGURED", "O catálogo ainda não está configurado no servidor.");
    return this.catalog;
  }
  private requiredPersistence(): UserPersistenceStore {
    if (!this.persistence) throw new ApiError(503, "USER_PERSISTENCE_NOT_CONFIGURED", "A persistência da conta ainda não está configurada.");
    return this.persistence;
  }
  private preferences(value: unknown): PersistedPreferences {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "INVALID_PREFERENCES", "Preferências inválidas.");
    const input = value as Record<string, unknown>;
    const theme = input.theme === "dark" ? "dark" : input.theme === "light" ? "light" : null;
    if (!theme || typeof input.onboardingCompleted !== "boolean" || !Array.isArray(input.genres) || input.genres.length > 80) throw new ApiError(400, "INVALID_PREFERENCES", "Preferências inválidas.");
    const genres: PersistedGenre[] = input.genres.map((genre): PersistedGenre | null => {
      if (!genre || typeof genre !== "object" || Array.isArray(genre)) return null;
      const entry = genre as Record<string, unknown>; const id = typeof entry.id === "string" ? entry.id.trim() : ""; const name = typeof entry.name === "string" ? entry.name.trim() : "";
      return id && id.length <= 100 && name && name.length <= 80 ? { id, name } : null;
    }).filter((genre): genre is PersistedGenre => Boolean(genre));
    if (genres.length !== input.genres.length) throw new ApiError(400, "INVALID_PREFERENCES", "Preferências inválidas.");
    return { onboardingCompleted: input.onboardingCompleted, theme, genres };
  }
  private libraryBook(value: unknown): PersistedLibraryBook {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "INVALID_LIBRARY_BOOK", "Livro inválido.");
    const input = value as Record<string, unknown>; const bookId = typeof input.bookId === "string" ? input.bookId.trim() : "";
    const metadata = input.metadata;
    if (!bookId || bookId.length > 160 || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new ApiError(400, "INVALID_LIBRARY_BOOK", "Livro inválido.");
    const encoded = JSON.stringify(metadata);
    if (Buffer.byteLength(encoded) > 12_000) throw new ApiError(413, "LIBRARY_METADATA_TOO_LARGE", "Metadados do livro excedem o limite.");
    const updatedAt = typeof input.updatedAt === "string" && Number.isFinite(Date.parse(input.updatedAt)) ? input.updatedAt : typeof (metadata as Record<string, unknown>).updatedAt === "string" ? (metadata as Record<string, unknown>).updatedAt as string : new Date().toISOString();
    return { bookId, metadata: metadata as Record<string, unknown>, updatedAt };
  }
  private async assertCatalogLicense(userId: string): Promise<void> {
    const license = await this.licenses.getForUser(userId);
    if (license.status !== "active") throw new ApiError(403, "LICENSE_REQUIRED", "Esta conta não possui uma licença ativa.");
  }
  private catalogQuery(request: AuthenticatedRequest): { offset: number; limit: number; locale?: string; query?: string; genreId?: string; author?: string; format?: "pdf" | "epub"; collection?: string } {
    const url = new URL(request.url ?? "/", "http://localhost"); const value = (name: string): string | undefined => url.searchParams.get(name)?.trim().slice(0, 120) || undefined;
    const offset = Math.max(0, Number.parseInt(value("cursor") ?? "0", 10) || 0); const format = value("format");
    if (format && format !== "pdf" && format !== "epub") throw new ApiError(400, "INVALID_CATALOG_FILTER", "Filtro de catálogo inválido.");
    const locale = value("locale");
    if (locale && !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale)) throw new ApiError(400, "INVALID_CATALOG_FILTER", "Filtro de catálogo inválido.");
    return { offset, limit: 24, locale, query: value("query"), genreId: value("genreId"), author: value("author"), collection: value("collection"), format: format as "pdf" | "epub" | undefined };
  }

  private async ensureProfile(action: "signup" | "login", userId: string, email: string): Promise<void> {
    this.logAuthStep(`${action}.profile.start`, { hasUserId: Boolean(userId), hasEmail: Boolean(email) });
    try {
      await this.profiles.ensure(userId, email);
    } catch (error) {
      this.logAuthStep(`${action}.profile.failed`, this.safeError(error));
      if (this.isMissingSchema(error)) {
        throw new ApiError(503, "DATABASE_SCHEMA_NOT_READY", "Banco de dados ainda não possui as tabelas necessárias.");
      }
      throw new ApiError(500, "PROFILE_SYNC_FAILED", "Não foi possível preparar o perfil do usuário.");
    }
  }

  private logAuthStep(step: string, details: Record<string, unknown> = {}): void {
    console.info(JSON.stringify({ event: "auth.flow", step, ...details }));
  }

  private safeError(error: unknown): Record<string, unknown> {
    const details = error as { code?: string; message?: string; details?: string; hint?: string; status?: number; name?: string };
    return {
      status: details.status ?? null,
      code: details.code ?? null,
      name: details.name ?? null,
      message: details.message ?? String(error),
      details: details.details ?? null,
      hint: details.hint ?? null,
    };
  }

  private isMissingSchema(error: unknown): boolean {
    const details = error as { code?: string; message?: string };
    const code = String(details.code ?? "");
    const message = String(details.message ?? "").toLowerCase();
    return code === "PGRST205" || message.includes("could not find the table");
  }
}
