import type { StorageAdapter } from "../../services/StorageService";
import { ANDROID_READER_DEFAULTS, DEFAULT_READER_PREFERENCES, type ReaderPreferences } from "./ReaderPreferences";

export class ReaderPreferencesService {
  private static readonly KEY = "reader-preferences";
  private value: ReaderPreferences = { ...DEFAULT_READER_PREFERENCES };
  /** On Android the untouched defaults are the e-reader ones; saved choices always win. */
  public constructor(private readonly storage: StorageAdapter, private readonly android = false) {}
  public get preferences(): Readonly<ReaderPreferences> { return this.value; }
  public async restorePreferences(): Promise<Readonly<ReaderPreferences>> {
    const saved = await this.storage.load<Partial<ReaderPreferences>>(ReaderPreferencesService.KEY);
    const value = this.normalize({ ...DEFAULT_READER_PREFERENCES, ...(this.android ? ANDROID_READER_DEFAULTS : {}), ...saved });
    // Installs from before the e-reader change kept the old defaults (Georgia, which Android does
    // not have, and ivory). Move only those untouched defaults, once; other choices stay.
    if (this.android && value.androidReaderDefaults < 1) {
      this.value = { ...value, androidReaderDefaults: 1,
        fontFamily: value.fontFamily === "classic" ? "book" : value.fontFamily,
        paperTheme: value.paperTheme === "ivory" && value.readingMode !== "book-real" ? "paper" : value.paperTheme };
      await this.storage.save(ReaderPreferencesService.KEY, this.value); return this.value;
    }
    this.value = value; return this.value;
  }
  public async savePreferences(changes: Partial<ReaderPreferences>): Promise<Readonly<ReaderPreferences>> {
    this.value = this.normalize({ ...this.value, ...changes });
    await this.storage.save(ReaderPreferencesService.KEY, this.value); return this.value;
  }
  private normalize(value: ReaderPreferences): ReaderPreferences {
    const animation = value.pageAnimation === ("none" as string) ? "page-turn" : value.pageAnimation;
    return { ...value, pageAnimation: animation, fontSize: Math.min(36, Math.max(13, Math.round(value.fontSize))),
      readerBrightness: Math.min(100, Math.max(15, Math.round(value.readerBrightness))),
      pomodoroEnabled: value.pomodoroEnabled === true,
      pomodoroGoalType: value.pomodoroGoalType === "pages" ? "pages" : "time",
      androidReaderDefaults: typeof value.androidReaderDefaults === "number" ? value.androidReaderDefaults : 0,
      pomodoroFocusMinutes: this.clamp(value.pomodoroFocusMinutes, 5, 90, 25),
      pomodoroBreakMinutes: this.clamp(value.pomodoroBreakMinutes, 1, 30, 5),
      dailyPagesGoal: this.clamp(value.dailyPagesGoal, 1, 500, 20),
      screenBrightness: value.screenBrightness === null || value.screenBrightness === undefined ? null : this.clamp(value.screenBrightness, 2, 100, 60) };
  }
  private clamp(value: unknown, min: number, max: number, fallback: number): number {
    const number = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
    return Math.min(max, Math.max(min, number));
  }
}
