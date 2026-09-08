import { ApiError } from "../errors/ApiError.js";
import type { AuthProvider } from "../services/AuthService.js";
import type { AuthenticatedRequest } from "../types/http.js";

export class AuthMiddleware {
  public constructor(private readonly authService: AuthProvider) {}
  public async requireAuth(request: AuthenticatedRequest): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new ApiError(401, "AUTH_REQUIRED", "Autenticação necessária.");
    request.user = await this.authService.verify(header.slice(7));
  }
}
