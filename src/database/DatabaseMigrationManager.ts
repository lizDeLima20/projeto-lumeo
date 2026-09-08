export interface DatabaseMigration {
  version: number;
  run(): Promise<void>;
}

export class DatabaseMigrationManager {
  public constructor(private readonly migrations: readonly DatabaseMigration[]) {}

  public async runFrom(currentVersion: number): Promise<number[]> {
    const executed: number[] = [];
    const ordered = [...this.migrations].filter((migration) => migration.version > currentVersion).sort((a, b) => a.version - b.version);
    for (const migration of ordered) {
      await migration.run();
      executed.push(migration.version);
    }
    return executed;
  }

  public requiresReset(_currentVersion: number): boolean {
    return false;
  }
}
