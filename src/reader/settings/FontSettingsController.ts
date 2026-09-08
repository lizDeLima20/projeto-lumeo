import type { ReaderFontFamily, ReaderSpacing, ReaderTextColor } from "./ReaderPreferences";
import { ReaderPreferencesService } from "./ReaderPreferencesService";
export class FontSettingsController {
  public constructor(private readonly service: ReaderPreferencesService) {}
  public changeFont(value: ReaderFontFamily) { return this.service.savePreferences({ fontFamily: value }); }
  public changeFontSize(value: number) { return this.service.savePreferences({ fontSize: value }); }
  public changeFontWeight(value: 300 | 400 | 700) { return this.service.savePreferences({ fontWeight: value }); }
  public changeTextColor(value: ReaderTextColor) { return this.service.savePreferences({ textColor: value }); }
  public changeSpacing(value: ReaderSpacing) { return this.service.savePreferences({ lineSpacing: value }); }
}
