export interface ApiErrorBody { error?: { code: string; message: string }; code?: string; message?: string; requestId?: string; }

import { I18nManager } from "../i18n/I18nManager";

export class ApiError extends Error {
  public constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export class ApiClient {
  private accessToken: string | null = null;
  private installationId: string | null = null;

  public constructor(private readonly baseUrl: string) {}
  public setAccessToken(token: string | null): void { this.accessToken = token; }
  public setInstallationId(id: string): void { this.installationId = id; }

  public get<T>(path: string, authenticated = true): Promise<T> {
    return this.request<T>(path, { method: "GET" }, authenticated);
  }
  public post<T>(path: string, body: unknown, authenticated = true): Promise<T> {
    return this.request<T>(path, { method: "POST", body: JSON.stringify(body) }, authenticated);
  }

  private async request<T>(path: string, init: RequestInit, authenticated: boolean): Promise<T> {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (authenticated) {
      if (!this.accessToken) throw new ApiError(401, "AUTH_REQUIRED", I18nManager.shared.messageForErrorCode("AUTH_REQUIRED")!);
      headers.set("Authorization", `Bearer ${this.accessToken}`);
    }
    if (this.installationId) headers.set("X-Installation-Id", this.installationId);
    let response: Response;
    try { response = await fetch(`${this.baseUrl}${path}`, { ...init, headers }); }
    catch { throw new ApiError(0, "NETWORK_ERROR", I18nManager.shared.messageForErrorCode("NETWORK_ERROR")!); }
    const data = await response.json() as T | ApiErrorBody;
    if (!response.ok) {
      const error = (data as ApiErrorBody).error;
      const code = error?.code ?? (data as ApiErrorBody).code ?? "API_ERROR";
      throw new ApiError(response.status, code, I18nManager.shared.messageForErrorCode(code) ?? error?.message ?? (data as ApiErrorBody).message ?? I18nManager.shared.messageForErrorCode("API_ERROR")!);
    }
    return data as T;
  }
}
