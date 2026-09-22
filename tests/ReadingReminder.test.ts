import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("lembrete de leitura Android", () => {
  it("mantém o alarme, a notificação e o rearmamento inteiramente no Android", async () => {
    const [plugin, receiver, scheduler, manifest, activity] = await Promise.all([
      readFile("android/app/src/main/java/com/lumeo/reader/ReadingReminderPlugin.java", "utf8"),
      readFile("android/app/src/main/java/com/lumeo/reader/ReadingReminderReceiver.java", "utf8"),
      readFile("android/app/src/main/java/com/lumeo/reader/ReadingReminderScheduler.java", "utf8"),
      readFile("android/app/src/main/AndroidManifest.xml", "utf8"),
      readFile("android/app/src/main/java/com/lumeo/reader/MainActivity.java", "utf8"),
    ]);
    assert.match(plugin, /@CapacitorPlugin\(name = "ReadingReminder"/);
    assert.match(plugin, /requestNotificationPermission/); assert.match(plugin, /saveReminders/); assert.match(plugin, /deleteReminder/); assert.match(plugin, /setReminderEnabled/);
    assert.match(receiver, /Hora da sua leitura/); assert.match(receiver, /notificacao_lembrete/); assert.match(receiver, /FLAG_INSISTENT/);
    assert.match(receiver, /REMINDER_RECEIVED/); assert.match(receiver, /REMINDER_NOTIFICATION_CREATED/); assert.match(receiver, /REMINDER_SOUND_STARTED/);
    assert.match(receiver, /rescheduleFromSaved/); assert.match(scheduler, /setAndAllowWhileIdle/); assert.match(scheduler, /KEY_REMINDERS/);
    assert.match(scheduler, /setExactAndAllowWhileIdle/); assert.match(scheduler, /REMINDER_SAVED/); assert.match(scheduler, /REMINDER_NEXT_TRIGGER/);
    assert.match(scheduler, /ACTION_REQUEST_SCHEDULE_EXACT_ALARM/); assert.match(scheduler, /REMINDER_EXACT_PERMISSION_REQUESTED/);
    assert.match(manifest, /POST_NOTIFICATIONS/); assert.match(manifest, /RECEIVE_BOOT_COMPLETED/);
    assert.match(manifest, /ReadingReminderBootReceiver/); assert.match(activity, /registerPlugin\(ReadingReminderPlugin\.class\)/);
    assert.match(activity, /registerPlugin\(ReaderSoundPlugin\.class\)/);
    assert.match(activity, /ReadingReminderScheduler\.ensureNotificationChannel\(this\)/);
    assert.match(activity, /ReadingReminderScheduler\.rescheduleFromSaved\(this\)/);
    const schedulerSource = await readFile("android/app/src/main/java/com/lumeo/reader/ReadingReminderScheduler.java", "utf8");
    assert.match(schedulerSource, /lumeo_reading_reminder_v3/); assert.match(schedulerSource, /notificacao_lembrete/); assert.match(schedulerSource, /ensureNotificationChannel/);
  });

  it("expõe múltiplos horários, dias e destino somente no Reader Android, sem fallback de timer Web", async () => {
    const [panel, bridge] = await Promise.all([
      readFile("src/views/ReaderSettingsPanel.ts", "utf8"), readFile("src/services/ReadingReminder.ts", "utf8"),
    ]);
    assert.match(panel, /ReadingReminder\.available/); assert.match(panel, /reader\.reminder\.time/); assert.match(panel, /reader\.reminder\.days/);
    assert.match(panel, /reader\.reminder\.library/); assert.match(panel, /reader\.reminder\.book/); assert.match(panel, /ReadingReminder\.saveReminders/);
    assert.match(bridge, /browser deliberately has no timer fallback/); assert.match(bridge, /NativeReadingReminder\.saveReminders/);
  });
});
