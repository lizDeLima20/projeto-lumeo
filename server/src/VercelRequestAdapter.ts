import type { IncomingMessage } from "node:http";

/** Reconstructs the BFF path forwarded by the explicit Vercel rewrite. */
export class VercelRequestAdapter {
  public static restorePath(request: IncomingMessage): void {
    const url = new URL(request.url ?? "/", "http://localhost");
    const route = url.searchParams.get("__lumeo_route");
    if (url.pathname !== "/api/index" || route === null) return;
    url.searchParams.delete("__lumeo_route");
    url.pathname = `/api/${route}`;
    request.url = `${url.pathname}${url.search}`;
  }
}
