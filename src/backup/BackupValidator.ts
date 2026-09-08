import type { LumeoBackup } from "./BackupService";

export interface BackupValidation {
  valid: boolean;
  errors: string[];
}

export class BackupValidator {
  public validate(backup: Partial<LumeoBackup>): BackupValidation {
    const errors: string[] = [];
    if (backup.manifest?.format !== "lumeo-backup") errors.push("invalidManifest");
    if (backup.manifest?.version !== 1) errors.push("unsupportedVersion");
    if (!backup.library || !Array.isArray(backup.library.books)) errors.push("missingLibrary");
    if (backup.manifest?.includesBooks && !Array.isArray(backup.books)) errors.push("missingBookFiles");
    return { valid: errors.length === 0, errors };
  }
}
