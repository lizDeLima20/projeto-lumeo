export interface StorageAdapter {
  load<T>(key: string): Promise<T | null>;
  save<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export class StorageService implements StorageAdapter {
  private readonly memory = new Map<string, unknown>();
  private readonly prefix = "lumeo:";

  public async load<T>(key: string): Promise<T | null> {
    try {
      const stored = window.localStorage.getItem(this.prefix + key);
      return stored === null ? null : JSON.parse(stored) as T;
    } catch {
      return (this.memory.get(key) as T | undefined) ?? null;
    }
  }

  public async save<T>(key: string, value: T): Promise<void> {
    this.memory.set(key, value);
    try { window.localStorage.setItem(this.prefix + key, JSON.stringify(value)); } catch { /* memory fallback */ }
  }

  public async remove(key: string): Promise<void> {
    this.memory.delete(key);
    try { window.localStorage.removeItem(this.prefix + key); } catch { /* memory fallback */ }
  }
}
