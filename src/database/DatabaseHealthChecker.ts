import { IndexedDbService, STORE_NAMES } from "../services/IndexedDbService";

export interface DatabaseHealthReport {
  healthy: boolean;
  version: number;
  missingStores: string[];
  orphanReferences: string[];
  invalidMetadata: string[];
}

export class DatabaseHealthChecker {
  public readonly expectedStores = Object.values(STORE_NAMES);

  public async check(database: IndexedDbService): Promise<DatabaseHealthReport> {
    const connection = await database.open();
    return this.checkStoreNames(Array.from(connection.objectStoreNames), connection.version);
  }

  public checkStoreNames(actualStores: readonly string[], version = IndexedDbService.SCHEMA_VERSION): DatabaseHealthReport {
    const missingStores = this.expectedStores.filter((store) => !actualStores.includes(store));
    return { healthy: missingStores.length === 0, version, missingStores, orphanReferences: [], invalidMetadata: [] };
  }
}
