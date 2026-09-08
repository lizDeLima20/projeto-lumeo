import type { ReaderPaper } from "./ReaderPreferences";
import { ReaderPreferencesService } from "./ReaderPreferencesService";
export class PaperSettingsController {
  public constructor(private readonly service: ReaderPreferencesService) {}
  public changePaper(value: ReaderPaper) { return this.service.savePreferences({ paperTheme: value, readingMode: "standard" }); }
  public changeBrightness(value: number) { return this.service.savePreferences({ readerBrightness: value }); }
  public enableBookReal() { return this.service.savePreferences({ readingMode: "book-real", paperTheme: "ivory", readerBrightness: 55, textColor: "soft-black", pageAnimation: "none" }); }
}
