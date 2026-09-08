import type { ReaderPageAnimation } from "./ReaderPreferences";
import { ReaderPreferencesService } from "./ReaderPreferencesService";
export class AnimationSettingsController {
  public constructor(private readonly service: ReaderPreferencesService) {}
  public changeAnimation(value: ReaderPageAnimation) { return this.service.savePreferences({ pageAnimation: value }); }
}
