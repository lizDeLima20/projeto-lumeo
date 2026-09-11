import type { ImageProfile, ReaderPreferences } from "./ReaderPreferences";
import { ReaderPreferencesService } from "./ReaderPreferencesService";
export type ReaderImagePreset = ReaderPreferences["imagePreset"];
export class ImageSettingsController {
  public constructor(private readonly service: ReaderPreferencesService) {}
  public changePreset(value: ReaderImagePreset) { return this.service.savePreferences({ imagePreset: value }); }
  public changeProfile(value: ImageProfile) { return this.service.savePreferences({ imageProfile: value }); }
}
