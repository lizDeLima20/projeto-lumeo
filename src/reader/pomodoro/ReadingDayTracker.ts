import type { StorageAdapter } from "../../services/StorageService";

/** One calendar day of reading, in the reader's local time. */
export interface ReadingDay {
  date: string;
  readingSeconds: number;
  pagesRead: number;
  pauses: number;
  resumes: number;
  /** Local "HH:MM" of the first reading of the day: the hour offered for tomorrow. */
  firstReadAt: string | null;
  /** The goal the reader was already asked about today, so it is asked once. */
  goalPromptedAt: number | null;
  goalDecision: "continue" | "tomorrow" | null;
  /** Pages counted today, per book, so going back and forth never counts a page twice. */
  pageKeys: string[];
}

export interface PageTurnResult { day: Readonly<ReadingDay>; goalReached: boolean; }

type ReadingDays = Record<string, ReadingDay>;

/**
 * Counts, per day, the minutes actually spent reading, the pages read, and the pauses and
 * returns of the Pomodoro Lumeo. Only the reader's own device keeps these numbers.
 */
export class ReadingDayTracker {
  public static readonly KEY = "reading-days";
  public static readonly keptDays = 60;
  private days: ReadingDays = {};
  private loaded = false;

  public constructor(private readonly storage: StorageAdapter, private readonly now: () => Date = () => new Date()) {}

  public async today(): Promise<Readonly<ReadingDay>> { await this.load(); return this.current(); }

  /** Adds reading time. Called by the Pomodoro clock only while the reader is actually reading. */
  public async addReadingSeconds(seconds: number): Promise<Readonly<ReadingDay>> {
    await this.load();
    const day = this.current();
    if (seconds > 0 && Number.isFinite(seconds)) {
      day.firstReadAt ??= this.clock();
      day.readingSeconds += Math.round(seconds);
      await this.save();
    }
    return day;
  }

  public async pause(): Promise<Readonly<ReadingDay>> { await this.load(); const day = this.current(); day.pauses++; await this.save(); return day; }
  public async resume(): Promise<Readonly<ReadingDay>> { await this.load(); const day = this.current(); day.resumes++; await this.save(); return day; }

  /** Records the pages a turn brought into view; reports when this turn met the daily goal. */
  public async pagesViewed(bookId: string, pages: readonly number[], dailyGoal: number): Promise<PageTurnResult> {
    await this.load();
    const day = this.current(), before = day.pagesRead;
    for (const page of pages) {
      if (!Number.isSafeInteger(page) || page < 1) continue;
      const key = `${bookId}#${page}`;
      if (day.pageKeys.includes(key)) continue;
      day.pageKeys.push(key); day.pagesRead++;
    }
    day.firstReadAt ??= this.clock();
    const goal = Math.max(1, Math.round(dailyGoal));
    const goalReached = before < goal && day.pagesRead >= goal && day.goalPromptedAt !== goal;
    if (goalReached) day.goalPromptedAt = goal;
    if (day.pagesRead !== before || goalReached) await this.save();
    return { day, goalReached };
  }

  public async decideGoal(decision: "continue" | "tomorrow"): Promise<Readonly<ReadingDay>> {
    await this.load(); const day = this.current(); day.goalDecision = decision; await this.save(); return day;
  }

  /** Local date key "YYYY-MM-DD"; a day ends at the reader's midnight, not UTC's. */
  public dateKey(date = this.now()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  private clock(date = this.now()): string { return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; }

  private current(): ReadingDay {
    const date = this.dateKey();
    return this.days[date] ??= { date, readingSeconds: 0, pagesRead: 0, pauses: 0, resumes: 0, firstReadAt: null, goalPromptedAt: null, goalDecision: null, pageKeys: [] };
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const saved = await this.storage.load<ReadingDays>(ReadingDayTracker.KEY);
    this.days = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    this.loaded = true;
  }

  private async save(): Promise<void> {
    const kept = Object.keys(this.days).sort().slice(-ReadingDayTracker.keptDays);
    this.days = Object.fromEntries(kept.map((date) => [date, this.days[date]!]));
    await this.storage.save(ReadingDayTracker.KEY, this.days);
  }
}
