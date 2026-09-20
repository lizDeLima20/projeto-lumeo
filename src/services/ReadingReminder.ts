import { Capacitor, registerPlugin, type Plugin } from "@capacitor/core";

/** Calendar's stable weekday values: 1 is Sunday and 7 is Saturday, matching Android. */
export type ReadingReminderDay = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type ReadingReminderTargetType = "library" | "book";
export interface ReadingReminderItem {
  id: string;
  enabled: boolean;
  hour: number;
  minute: number;
  days: ReadingReminderDay[];
  targetType: ReadingReminderTargetType;
  bookId?: string;
  bookTitle?: string;
}
export interface ReadingReminderState { enabled: boolean; hour: number; minute: number; days: ReadingReminderDay[]; reminders?: ReadingReminderItem[]; }
export type ReadingReminderInput = Omit<ReadingReminderItem, "id" | "enabled"> & { id?: string; enabled?: boolean };

interface ReadingReminderPlugin extends Plugin {
  getState(): Promise<ReadingReminderState>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  schedule(options: Omit<ReadingReminderState, "enabled">): Promise<ReadingReminderState>;
  saveReminders(options: { reminders: ReadingReminderInput[] }): Promise<ReadingReminderState>;
  deleteReminder(options: { id: string }): Promise<ReadingReminderState>;
  setReminderEnabled(options: { id: string; enabled: boolean }): Promise<ReadingReminderState>;
  cancel(): Promise<ReadingReminderState>;
}

const NativeReadingReminder = registerPlugin<ReadingReminderPlugin>("ReadingReminder");

/** The browser deliberately has no timer fallback: reminders must work after Android closes Lumeo. */
export class ReadingReminder {
  public static get available(): boolean {
    return typeof window !== "undefined" && Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("ReadingReminder");
  }
  public static async state(): Promise<ReadingReminderState | null> {
    if (!ReadingReminder.available) return null;
    try { return await NativeReadingReminder.getState(); } catch { return null; }
  }
  public static async schedule(value: Omit<ReadingReminderState, "enabled">): Promise<{ state: ReadingReminderState; permissionGranted: boolean } | null> {
    if (!ReadingReminder.available || value.days.length === 0) return null;
    try {
      const permission = await NativeReadingReminder.requestNotificationPermission();
      if (!permission.granted) return null;
      return { state: await NativeReadingReminder.schedule(value), permissionGranted: true };
    } catch { return null; }
  }
  public static async saveReminders(reminders: ReadingReminderInput[]): Promise<{ state: ReadingReminderState; permissionGranted: boolean } | null> {
    if (!ReadingReminder.available) return null;
    try {
      const permission = await NativeReadingReminder.requestNotificationPermission();
      if (!permission.granted) return null;
      return { state: await NativeReadingReminder.saveReminders({ reminders }), permissionGranted: true };
    } catch { return null; }
  }
  public static async deleteReminder(id: string): Promise<ReadingReminderState | null> {
    if (!ReadingReminder.available) return null;
    try { return await NativeReadingReminder.deleteReminder({ id }); } catch { return null; }
  }
  public static async setReminderEnabled(id: string, enabled: boolean): Promise<ReadingReminderState | null> {
    if (!ReadingReminder.available) return null;
    try { return await NativeReadingReminder.setReminderEnabled({ id, enabled }); } catch { return null; }
  }
  public static async cancel(): Promise<ReadingReminderState | null> {
    if (!ReadingReminder.available) return null;
    try { return await NativeReadingReminder.cancel(); } catch { return null; }
  }
}
