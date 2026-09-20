export interface ApiErrorBody { error?: { code: string; message: string }; code?: string; message?: string; requestId?: string; }

import { I18nManager } from "../i18n/I18nManager";
import { Capacitor } from "@capacitor/core";

export class ApiError extends Error {
  public constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export class ApiClient {
  private accessToken: string | null = null;
  private installationId: string | null = null;
  private refreshSession: (() => Promise<void>) | null = null;

  public constructor(private readonly baseUrl: string) {}
  public setAccessToken(token: string | null): void { this.accessToken = token; }
  public setInstallationId(id: string): void { this.installationId = id; }
  /** Registered by AuthManager. A request retries once only after a real refresh. */
  public setSessionRefreshHandler(handler: (() => Promise<void>) | null): void { this.refreshSession = handler; }

  public get<T>(path: string, authenticated = true): Promise<T> {
    return this.request<T>(path, { method: "GET" }, authenticated);
  }
  public post<T>(path: string, body: unknown, authenticated = true): Promise<T> {
    return this.request<T>(path, { method: "POST", body: JSON.stringify(body) }, authenticated);
  }

  /** Streams a protected book download while keeping its credentials out of URLs. */
  public async download(path: string, onProgress: (percent: number | null) => void, signal?: AbortSignal): Promise<File> {
    const response = await this.fetchWithRefresh(path, { signal }, true);
    if (!response.ok) await this.throwResponseError(response);
    const contentLength = Number(response.headers.get("content-length")) || 0;
    const chunks: BlobPart[] = []; let received = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) { chunks.push(new Uint8Array(value)); received += value.byteLength; onProgress(contentLength ? Math.round(received / contentLength * 100) : null); }
      }
    } else chunks.push(await response.blob());
    const disposition = response.headers.get("content-disposition") ?? "";
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    const name = encodedName ? decodeURIComponent(encodedName) : plainName ?? "livro";
    return new File(chunks, name, { type: response.headers.get("content-type") ?? "application/octet-stream" });
  }

  private async request<T>(path: string, init: RequestInit, authenticated: boolean): Promise<T> {
    const response = await this.fetchWithRefresh(path, init, authenticated);
    const data = await response.json() as T | ApiErrorBody;
    if (!response.ok) this.throwBodyError(response.status, data as ApiErrorBody);
    return data as T;
  }
  private async fetchWithRefresh(path: string, init: RequestInit, authenticated: boolean): Promise<Response> {
    let response = await this.send(path, init, authenticated);
    // An isolated 401 is commonly an expired access token. Refresh once and
    // replay the same request; never create a refresh/retry loop.
    if (authenticated && response.status === 401 && this.refreshSession) {
      try { await this.refreshSession(); }
      catch { return response; }
      response = await this.send(path, init, authenticated);
    }
    return response;
  }
  private async send(path: string, init: RequestInit, authenticated: boolean): Promise<Response> {
    const headers = this.authHeaders(authenticated);
    const supplied = new Headers(init.headers); supplied.forEach((value, key) => headers.set(key, value));
    if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const endpoint = path.split("?", 1)[0]!.replace(/^(\/catalog\/books)\/[^/]+/, "$1/:id");
    const logAndroid = (status: number): void => {
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
        console.info(JSON.stringify({ event: "ANDROID_API_RESPONSE", endpoint, status, authorizationPresent: headers.has("Authorization") }));
      }
    };
    try {
      const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
      logAndroid(response.status);
      return response;
    }
    catch (error) {
      logAndroid(0);
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ApiError(0, "NETWORK_ERROR", I18nManager.shared.messageForErrorCode("NETWORK_ERROR")!);
    }
  }

  private authHeaders(authenticated: boolean): Headers {
    const headers = new Headers();
    if (authenticated) {
      if (!this.accessToken) throw new ApiError(401, "AUTH_REQUIRED", I18nManager.shared.messageForErrorCode("AUTH_REQUIRED")!);
      headers.set("Authorization", `Bearer ${this.accessToken}`);
    }
    if (this.installationId) headers.set("X-Installation-Id", this.installationId);
    return headers;
  }
  private async throwResponseError(response: Response): Promise<never> {
    let body: ApiErrorBody = {};
    try { body = await response.json() as ApiErrorBody; } catch { /* safe generic fallback */ }
    return this.throwBodyError(response.status, body);
  }
  private throwBodyError(status: number, body: ApiErrorBody): never {
    const error = body.error; const code = error?.code ?? body.code ?? "API_ERROR";
    throw new ApiError(status, code, I18nManager.shared.messageForErrorCode(code) ?? error?.message ?? body.message ?? I18nManager.shared.messageForErrorCode("API_ERROR")!);
  }
}
