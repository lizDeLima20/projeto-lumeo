import type { IncomingMessage, ServerResponse } from "node:http";
import { ServerApp } from "../server/src/app.js";
import { VercelRequestAdapter } from "../server/src/VercelRequestAdapter.js";

const handler = ServerApp.create();
export default function api(request: IncomingMessage, response: ServerResponse): Promise<void> {
  VercelRequestAdapter.restorePath(request);
  return handler(request, response);
}
