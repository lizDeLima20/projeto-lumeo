import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthenticatedUser } from "./domain.js";

export interface AuthenticatedRequest extends IncomingMessage { user?: AuthenticatedUser; }
export type ApiResponse = ServerResponse<IncomingMessage>;
export interface AuthSessionResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  user: AuthenticatedUser;
}
