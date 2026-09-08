import type { DatabaseHealthReport } from "./DatabaseHealthChecker";

export interface RecoveryResult {
  repaired: boolean;
  resetRequired: boolean;
  preservedOriginalBookFiles: boolean;
  removedTemporaryRecords: string[];
}

export class DatabaseRecoveryManager {
  public recover(report: DatabaseHealthReport): RecoveryResult {
    const recoverable = report.missingStores.length === 0;
    return {
      repaired: recoverable,
      resetRequired: !recoverable,
      preservedOriginalBookFiles: true,
      removedTemporaryRecords: recoverable ? report.orphanReferences : [],
    };
  }
}
