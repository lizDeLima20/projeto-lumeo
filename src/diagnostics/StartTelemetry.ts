export type BookDownloadStage = "PREPARING" | "DOWNLOADING" | "VALIDATING" | "SAVING" | "READY" | "ERROR";
export type BookDownloadCode =
  | "CATALOG_BOOK_NOT_FOUND" | "DOWNLOAD_URL_FAILED" | "DOWNLOAD_HTTP_401" | "DOWNLOAD_HTTP_403"
  | "DOWNLOAD_HTTP_404" | "DOWNLOAD_CORS_FAILED" | "DOWNLOAD_NETWORK_FAILED" | "EPUB_INVALID"
  | "INDEXEDDB_SAVE_FAILED" | "DOWNLOAD_ALREADY_RUNNING" | "MOBILE_API_UNSUPPORTED" | "DOWNLOAD_TIMEOUT";

export class BookDownloadError extends Error {
  public constructor(public readonly code: BookDownloadCode, public readonly stage: BookDownloadStage,
    public readonly bookId: string, public readonly status?: number, public readonly retryable = false, cause?: unknown) {
    super(BookDownloadError.userMessage(code)); this.name = "BookDownloadError";
    if (cause !== undefined) Object.defineProperty(this, "cause", { value: cause, enumerable: false });
  }
  private static userMessage(code: BookDownloadCode): string {
    if (code === "DOWNLOAD_ALREADY_RUNNING") return "Este livro já está sendo baixado.";
    if (code === "DOWNLOAD_NETWORK_FAILED" || code === "DOWNLOAD_TIMEOUT" || code === "DOWNLOAD_CORS_FAILED") return "Não foi possível baixar o livro. Tentar novamente.";
    return "Não foi possível adicionar este livro.";
  }
}

function environment(): "mobile" | "desktop" | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? "mobile" : "desktop";
}
function safeUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return undefined; }
}
function safeError(error: unknown): { name: string; message: string } {
  const redact = (value: string): string => value
    .replace(/([?&](?:access_token|refresh_token|token|authorization|cookie)=)[^\s&]+/gi, "$1[redacted]")
    .replace(/Bearer\s+[\w.-]+/gi, "Bearer [redacted]").slice(0, 240);
  if (error instanceof Error) return { name: error.name, message: redact(error.message) };
  return { name: typeof error, message: redact(String(error)) };
}
export class StartTelemetry {
  public static request(bookId: string, url: string | undefined, stage: BookDownloadStage): void {
    console.info("LUMEO_START_REQUEST", { bookId, url: safeUrl(url), environment: environment(),
      userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent, stage });
  }
  public static failed(bookId: string, url: string | undefined, stage: BookDownloadStage, error: unknown, status?: number): void {
    console.error("LUMEO_START_FAILED", { bookId, url: safeUrl(url), environment: environment(),
      userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent, stage, status, error: safeError(error) });
  }
}
