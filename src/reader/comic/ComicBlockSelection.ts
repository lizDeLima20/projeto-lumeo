/** Which block is open, and nothing else. Kept apart from the DOM so the rules - one block
 *  at a time, a second tap closes, tapping outside closes, a page change closes - are the
 *  same wherever the overlay is mounted. */
export class ComicBlockSelection {
  private current: string | null = null;
  public get openId(): string | null { return this.current; }
  public get isOpen(): boolean { return this.current !== null; }
  /** Tapping the open block closes it; tapping another one swaps, never stacks. */
  public toggle(id: string): string | null { this.current = this.current === id ? null : id; return this.current; }
  public close(): null { this.current = null; return null; }
}
