import type { StorageAdapter } from "../services/StorageService";

export type RecoverableOperationKind = "import" | "lima-conversion" | "migration" | "backup" | "restore";
export interface RecoverableOperation {
  id: string;
  kind: RecoverableOperationKind;
  startedAt: string;
  state: "running" | "completed" | "failed";
  bookId?: string;
}

export class OperationRecoveryJournal {
  private static readonly KEY = "operationRecoveryJournal";
  public constructor(private readonly storage: StorageAdapter) {}

  public async begin(operation: Omit<RecoverableOperation, "startedAt" | "state">): Promise<RecoverableOperation> {
    const row = { ...operation, startedAt: new Date().toISOString(), state: "running" as const };
    const all = await this.pending();
    await this.storage.save(OperationRecoveryJournal.KEY, [...all, row]);
    return row;
  }

  public async complete(id: string): Promise<void> {
    await this.storage.save(OperationRecoveryJournal.KEY, (await this.pending()).map((item) => item.id === id ? { ...item, state: "completed" as const } : item));
  }

  public async pending(): Promise<RecoverableOperation[]> {
    const rows = await this.storage.load<RecoverableOperation[]>(OperationRecoveryJournal.KEY) ?? [];
    return rows.filter((row) => row.state === "running");
  }

  public async ghostsAfterInterruptedImport(): Promise<string[]> {
    return (await this.pending()).filter((row) => row.kind === "import" && row.bookId).map((row) => row.bookId as string);
  }
}
