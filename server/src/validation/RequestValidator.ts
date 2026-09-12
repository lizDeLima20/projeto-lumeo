import { ApiError } from "../errors/ApiError.js";

export class RequestValidator {
  public email(value: unknown): string {
    const email = this.string(value, "INVALID_EMAIL").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new ApiError(400, "INVALID_EMAIL", "E-mail inválido.");
    return email;
  }

  public password(value: unknown): string {
    const password = this.string(value, "INVALID_PASSWORD");
    if (password.length < 8 || password.length > 128) throw new ApiError(400, "INVALID_PASSWORD", "A senha deve ter entre 8 e 128 caracteres.");
    return password;
  }

  public deviceName(value: unknown): string {
    const name = this.string(value, "INVALID_DEVICE_NAME").trim();
    if (name.length < 1 || name.length > 80) throw new ApiError(400, "INVALID_DEVICE_NAME", "Nome do dispositivo inválido.");
    return name;
  }

  public token(value: unknown): string {
    const token = this.string(value, "INVALID_TOKEN").trim();
    if (token.length < 16 || token.length > 4096) throw new ApiError(400, "INVALID_TOKEN", "Token inválido.");
    return token;
  }

  /** The raw nonce whose SHA-256 the browser gave Google. */
  public nonce(value: unknown): string {
    const nonce = this.string(value, "INVALID_NONCE").trim();
    if (!/^[A-Za-z0-9_-]{16,256}$/.test(nonce)) throw new ApiError(400, "INVALID_NONCE", "Dados inválidos.");
    return nonce;
  }

  public installationId(value: unknown): string {
    const id = this.string(value, "INSTALLATION_ID_REQUIRED").trim();
    if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(id)) throw new ApiError(400, "INVALID_INSTALLATION_ID", "Identificador de instalação inválido.");
    return id;
  }

  public string(value: unknown, code = "INVALID_INPUT"): string {
    if (typeof value !== "string") throw new ApiError(400, code, "Dados inválidos.");
    return value;
  }
}
