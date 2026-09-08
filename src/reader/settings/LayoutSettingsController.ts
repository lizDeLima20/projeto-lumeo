import type { ReaderMargins, ReaderPageLayout } from "./ReaderPreferences";
import { ReaderPreferencesService } from "./ReaderPreferencesService";
export class LayoutSettingsController {
  public constructor(private readonly service: ReaderPreferencesService) {}
  public allowsTwoPages(viewportWidth: number): boolean { return viewportWidth >= 768; }
  public changeLayout(value: ReaderPageLayout, viewportWidth: number) {
    return this.service.savePreferences({ pageLayout: value === "double" && !this.allowsTwoPages(viewportWidth) ? "single" : value });
  }
  public changeMargins(value: ReaderMargins) { return this.service.savePreferences({ margins: value }); }
}
