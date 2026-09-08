import type { IncomingMessage, ServerResponse } from "node:http";
import { ServerApp } from "../server/src/app.js";

const handler = ServerApp.create();
export default function api(request: IncomingMessage, response: ServerResponse): Promise<void> {
  return handler(request, response);
}
