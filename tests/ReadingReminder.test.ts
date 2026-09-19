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
    assert.match(plugin, /requestNotificationPermission/); assert.match(plugin, /ReadingReminderScheduler\.arm/);
    assert.match(receiver, /Hora da sua leitura/); assert.match(receiver, /Que tal continuar seu livro\?/);
    assert.match(receiver, /rescheduleFromSaved/); assert.match(scheduler, /setAndAllowWhileIdle/);
    assert.match(manifest, /POST_NOTIFICATIONS/); assert.match(manifest, /RECEIVE_BOOT_COMPLETED/);
    assert.match(manifest, /ReadingReminderBootReceiver/); assert.match(activity, /registerPlugin\(ReadingReminderPlugin\.class\)/);
  });

  it("expõe horário e dias somente no Reader Android, sem fallback de timer Web", async () => {
    const [panel, bridge] = await Promise.all([
      readFile("src/views/ReaderSettingsPanel.ts", "utf8"), readFile("src/services/ReadingReminder.ts", "utf8"),
    ]);
    assert.match(panel, /ReadingReminder\.available/); assert.match(panel, /reader\.reminder\.time/); assert.match(panel, /reader\.reminder\.days/);
    assert.match(bridge, /browser deliberately has no timer fallback/); assert.match(bridge, /NativeReadingReminder\.schedule/);
  });
});
