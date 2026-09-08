import type { ConnectivityState } from "../pwa/ConnectivityManager";
import type { AppVersionInfo } from "../pwa/AppVersionManager";
import type { LocalStorageReport } from "../storage/LocalStorageManager";

export interface DiagnosticInput {
  versions: AppVersionInfo;
  connectivity: ConnectivityState;
  storage: Pick<LocalStorageReport, "usage" | "quota" | "available" | "lowSpace">;
  persistent: boolean;
  lastMigration?: number;
  lastRecovery?: string;
  errors?: readonly { code: string; message: string }[];
}

export class DiagnosticExporter {
  private static readonly PRIVATE_KEYS = ["bookText", "content", "note", "notes", "highlight", "highlights", "email", "file", "blob", "readerText"];

  public export(input: DiagnosticInput): string {
    return JSON.stringify(this.stripPrivate(input), null, 2);
  }

  public stripPrivate<T>(value: T): T {
    if (Array.isArray(value)) return value.map((item) => this.stripPrivate(item)) as T;
    if (value && typeof value === "object") {
      const safe: Record<string, unknown> = {};
      Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
        if (DiagnosticExporter.PRIVATE_KEYS.includes(key)) return;
        safe[key] = this.stripPrivate(entry);
      });
      return safe as T;
    }
    return value;
  }
}
