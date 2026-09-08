export type LogLevel = "debug" | "info" | "warn" | "error";

export class StructuredLogger {
  private static readonly PRIVATE_KEYS = ["password", "token", "authorization", "serviceRole", "bookText", "note", "highlight", "backup"];
  public constructor(private readonly environment = process.env.NODE_ENV ?? "development") {}

  public log(level: LogLevel, message: string, context: Record<string, unknown> = {}): void {
    if (level === "debug" && this.environment === "production") return;
    const row = { level, message, ...this.sanitize(context), timestamp: new Date().toISOString() };
    const line = JSON.stringify(row);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
  }

  public sanitize(context: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(context).filter(([key]) => !StructuredLogger.PRIVATE_KEYS.includes(key)));
  }
}
