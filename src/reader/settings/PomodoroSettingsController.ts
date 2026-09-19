import type { ReaderPreferences } from "./ReaderPreferences";
import { ReaderPreferencesService } from "./ReaderPreferencesService";
export class PomodoroSettingsController {
  public constructor(private readonly service: ReaderPreferencesService) {}
  public toggle(enabled: boolean) { return this.service.savePreferences({ pomodoroEnabled: enabled }); }
  public changeGoalType(value: ReaderPreferences["pomodoroGoalType"]) { return this.service.savePreferences({ pomodoroGoalType: value }); }
  public changeFocus(minutes: number) { return this.service.savePreferences({ pomodoroFocusMinutes: minutes }); }
  public changeBreak(minutes: number) { return this.service.savePreferences({ pomodoroBreakMinutes: minutes }); }
  public changeDailyGoal(pages: number) { return this.service.savePreferences({ dailyPagesGoal: pages }); }
}
