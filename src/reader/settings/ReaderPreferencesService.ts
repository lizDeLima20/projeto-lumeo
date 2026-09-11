import type { StorageAdapter } from "../../services/StorageService";
import { DEFAULT_READER_PREFERENCES, type ReaderPreferences } from "./ReaderPreferences";

export class ReaderPreferencesService {
  private static readonly KEY = "reader-preferences";
  private value: ReaderPreferences = { ...DEFAULT_READER_PREFERENCES };
  public constructor(private readonly storage: StorageAdapter) {}
  public get preferences(): Readonly<ReaderPreferences> { return this.value; }
  public async restorePreferences(): Promise<Readonly<ReaderPreferences>> {
    const saved = await this.storage.load<Partial<ReaderPreferences>>(ReaderPreferencesService.KEY);
    this.value = this.normalize({ ...DEFAULT_READER_PREFERENCES, ...saved }); return this.value;
  }
  public async savePreferences(changes: Partial<ReaderPreferences>): Promise<Readonly<ReaderPreferences>> {
    this.value = this.normalize({ ...this.value, ...changes });
    await this.storage.save(ReaderPreferencesService.KEY, this.value); return this.value;
  }
  private normalize(value: ReaderPreferences): ReaderPreferences {
    const animation = value.pageAnimation === ("none" as string) ? "page-turn" : value.pageAnimation;
    return { ...value, pageAnimation: animation, fontSize: Math.min(36, Math.max(13, Math.round(value.fontSize))),
      readerBrightness: Math.min(100, Math.max(15, Math.round(value.readerBrightness))) };
  }
}
