/** Keeps a folder's answer for a short while so paging back and forth does not re-ask
 *  Drive for something that just arrived. Bounded, and time-limited so a folder added in
 *  Drive shows up without a deploy. */
export class DriveFolderCache<T> {
  private readonly values = new Map<string, { value: T; expiresAt: number }>();
  public constructor(private readonly ttlMs = 300_000, private readonly limit = 200,
    private readonly now: () => number = () => Date.now()) {}

  public get(key: string): T | null {
    const hit = this.values.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= this.now()) { this.values.delete(key); return null; }
    // Refresh recency: the folders a reader keeps returning to are the ones worth keeping.
    this.values.delete(key); this.values.set(key, hit);
    return hit.value;
  }

  public set(key: string, value: T): void {
    this.values.delete(key);
    this.values.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.values.size > this.limit) {
      const oldest = this.values.keys().next().value;
      if (oldest === undefined) return;
      this.values.delete(oldest);
    }
  }

  public clear(): void { this.values.clear(); }
  public get size(): number { return this.values.size; }
}
