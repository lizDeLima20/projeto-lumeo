import type { ReaderPaper } from "./ReaderPreferences";
import { ReaderPreferencesService } from "./ReaderPreferencesService";
export class PaperSettingsController {
  public constructor(private readonly service: ReaderPreferencesService) {}
  public changePaper(value: ReaderPaper) { return this.service.savePreferences({ paperTheme: value, readingMode: "standard" }); }
  public changeBrightness(value: number) { return this.service.savePreferences({ readerBrightness: value }); }
  /** The mode that reads as a physical book turns its leaves. It used to save
   *  pageAnimation:"none", which left the most book-like mode as the only one
   *  without a page turn. */
  public static readonly bookRealAnimation = "page-turn" as const;
  public enableBookReal() { return this.service.savePreferences({ readingMode: "book-real", paperTheme: "ivory", readerBrightness: 55, textColor: "soft-black", pageAnimation: PaperSettingsController.bookRealAnimation }); }
}
