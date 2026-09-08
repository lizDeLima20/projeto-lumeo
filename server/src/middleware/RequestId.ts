import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export class RequestId {
  public static readonly HEADER = "X-Request-Id";

  public assign(request: IncomingMessage, response: ServerResponse): string {
    const supplied = request.headers["x-request-id"];
    const id = typeof supplied === "string" && /^[a-zA-Z0-9._:-]{8,128}$/.test(supplied) ? supplied : randomUUID();
    response.setHeader(RequestId.HEADER, id);
    return id;
  }
}
