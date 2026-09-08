import type { LumeoBackup } from "./BackupService";
import { BackupValidator } from "./BackupValidator";

export type RestoreConflictStrategy = "keep-current" | "replace-metadata" | "copy";
export interface RestoreResult {
  restoredBooks: number;
  conflicts: string[];
  strategy: RestoreConflictStrategy;
}

export class BackupRestorer {
  public constructor(private readonly validator = new BackupValidator()) {}

  public restore(backup: LumeoBackup, existingBookIds: readonly string[], strategy: RestoreConflictStrategy = "keep-current"): RestoreResult {
    const validation = this.validator.validate(backup);
    if (!validation.valid) throw new Error(validation.errors.join(", "));
    const conflicts = backup.library.books.filter((book) => existingBookIds.includes(book.id)).map((book) => book.id);
    const restoredBooks = backup.library.books.length - (strategy === "keep-current" ? conflicts.length : 0);
    return { restoredBooks, conflicts, strategy };
  }
}
