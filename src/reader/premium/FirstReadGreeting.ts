import type { StorageAdapter } from "../../services/StorageService";

/**
 * The discreet "hope you enjoy this book" message shown exactly once, the very first time
 * a book is opened with no progress at all. A book that was opened before (even if the
 * reader never turned a page, e.g. on Desktop, which has its own permanent greeting) never
 * shows it again once marked - matching "não repetir essa mensagem toda vez".
 */
export class FirstReadGreeting {
  private static readonly KEY = "reader-greeted-books";
  private static readonly kept = 500;
  public constructor(private readonly storage: StorageAdapter) {}

  public async shouldGreet(bookId: string, hasStartedReading: boolean): Promise<boolean> {
    if (hasStartedReading) return false;
    const seen = await this.storage.load<string[]>(FirstReadGreeting.KEY);
    return !(seen ?? []).includes(bookId);
  }

  public async markGreeted(bookId: string): Promise<void> {
    const seen = (await this.storage.load<string[]>(FirstReadGreeting.KEY)) ?? [];
    if (seen.includes(bookId)) return;
    await this.storage.save(FirstReadGreeting.KEY, [...seen, bookId].slice(-FirstReadGreeting.kept));
  }
}
