package com.lumeo.reader;

import android.app.AlarmManager;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.UUID;

final class ReadingReminderScheduler {
    static final String PREFS = "lumeo_reading_reminder";
    static final String EXTRA_REMINDER_ID = "reminderId";
    private static final String TAG = "ReadingReminder";
    private static final String KEY_REMINDERS = "reminders";
    static final String CHANNEL_ID = "lumeo_reading_reminder_v3";

    private ReadingReminderScheduler() {}

    static SharedPreferences prefs(Context context) { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static List<ReadingReminderRecord> reminders(Context context) {
        List<ReadingReminderRecord> reminders = new ArrayList<>();
        String raw = prefs(context).getString(KEY_REMINDERS, "[]");
        try {
            JSONArray array = new JSONArray(raw == null ? "[]" : raw);
            for (int index = 0; index < array.length(); index++) reminders.add(ReadingReminderRecord.fromJson(array.getJSONObject(index)));
        } catch (Exception error) { Log.i(TAG, "reminder.state.invalid_json"); }
        return reminders;
    }

    static void saveAll(Context context, List<ReadingReminderRecord> reminders) {
        JSONArray array = new JSONArray();
        for (ReadingReminderRecord reminder : reminders) array.put(reminder.toJson());
        prefs(context).edit().putString(KEY_REMINDERS, array.toString()).apply();
    }

    static void replaceAll(Context context, List<ReadingReminderRecord> reminders) {
        cancelAll(context);
        saveAll(context, reminders);
        Log.i(TAG, "REMINDER_SAVED count=" + reminders.size());
        ensureNotificationChannel(context);
        armAll(context);
    }

    static void cancelAll(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        for (ReadingReminderRecord reminder : reminders(context)) alarms.cancel(pendingIntent(context, reminder.id));
    }

    static void armAll(Context context) {
        for (ReadingReminderRecord reminder : reminders(context)) if (reminder.enabled) arm(context, reminder);
    }

    static void rescheduleFromSaved(Context context) { armAll(context); }

    /** Android 12+ denies precise alarms by default for newly installed apps.
     * Ask through the system's special-access screen; never fake this grant. */
    static void requestExactAlarmPermission(Activity activity) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
        AlarmManager alarms = activity.getSystemService(AlarmManager.class);
        if (alarms == null || alarms.canScheduleExactAlarms()) return;
        try {
            Intent settings = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
                .setData(Uri.parse("package:" + activity.getPackageName()));
            activity.startActivity(settings);
            Log.i(TAG, "REMINDER_EXACT_PERMISSION_REQUESTED");
        } catch (Exception error) {
            Log.e(TAG, "REMINDER_ERROR stage=exact_alarm_permission_request");
        }
    }

    static void arm(Context context, ReadingReminderRecord reminder) {
        if (reminder.days.length == 0 || !reminder.enabled) return;
        ensureNotificationChannel(context);
        long next = nextOccurrence(reminder.hour, reminder.minute, reminder.days);
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) {
            Log.e(TAG, "REMINDER_ERROR stage=alarm_manager_unavailable");
            return;
        }
        PendingIntent pending = pendingIntent(context, reminder.id);
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms();
        if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending);
        else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending);
        Log.i(TAG, "REMINDER_NEXT_TRIGGER id=" + safe(reminder.id) + " epochMs=" + next + " timezone=" + java.util.TimeZone.getDefault().getID());
        Log.i(TAG, "REMINDER_SCHEDULED id=" + safe(reminder.id) + " exact=" + exact + " days=" + reminder.days.length);
    }

    /** Android channels are immutable after first creation. v3 restores the
     * configured Lumeo sound even when an older silent channel exists. */
    static void ensureNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        Uri sound = Uri.parse("android.resource://" + context.getPackageName() + "/raw/notificacao_lembrete");
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Lembrete de leitura", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Lembretes diários de leitura do Lumeo");
        channel.setSound(sound, attributes);
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 350, 180, 350});
        manager.createNotificationChannel(channel);
        Log.i(TAG, "REMINDER_CHANNEL_READY sound=notificacao_lembrete");
    }

    private static PendingIntent pendingIntent(Context context, String id) {
        Intent intent = new Intent(context, ReadingReminderReceiver.class).putExtra(EXTRA_REMINDER_ID, id);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, requestCode(id), intent, flags);
    }

    static int requestCode(String id) { return 2000 + Math.abs((id == null ? "" : id).hashCode() % 700000); }

    static long nextOccurrence(int hour, int minute, int[] days) {
        Calendar now = Calendar.getInstance();
        for (int offset = 0; offset < 8; offset++) {
            Calendar candidate = (Calendar) now.clone();
            candidate.add(Calendar.DAY_OF_YEAR, offset);
            candidate.set(Calendar.HOUR_OF_DAY, hour);
            candidate.set(Calendar.MINUTE, minute);
            candidate.set(Calendar.SECOND, 0);
            candidate.set(Calendar.MILLISECOND, 0);
            if (!candidate.after(now)) continue;
            int weekday = candidate.get(Calendar.DAY_OF_WEEK);
            for (int day : days) if (day == weekday) return candidate.getTimeInMillis();
        }
        Calendar fallback = (Calendar) now.clone();
        fallback.add(Calendar.DAY_OF_YEAR, 1);
        fallback.set(Calendar.HOUR_OF_DAY, hour); fallback.set(Calendar.MINUTE, minute);
        fallback.set(Calendar.SECOND, 0); fallback.set(Calendar.MILLISECOND, 0);
        return fallback.getTimeInMillis();
    }

    static String safe(String value) { return value == null ? "unknown" : value.replaceAll("[^A-Za-z0-9._-]", "_"); }

    static final class ReadingReminderRecord {
        final String id;
        final boolean enabled;
        final int hour;
        final int minute;
        final int[] days;
        final String targetType;
        final String bookId;
        final String bookTitle;

        ReadingReminderRecord(String id, boolean enabled, int hour, int minute, int[] days, String targetType, String bookId, String bookTitle) {
            this.id = id == null || id.trim().isEmpty() ? UUID.randomUUID().toString() : id;
            this.enabled = enabled; this.hour = hour; this.minute = minute; this.days = days;
            this.targetType = "book".equals(targetType) && bookId != null && !bookId.trim().isEmpty() ? "book" : "library";
            this.bookId = this.targetType.equals("book") ? bookId : "";
            this.bookTitle = bookTitle == null ? "" : bookTitle;
        }

        static ReadingReminderRecord fromJson(JSONObject json) {
            JSONArray rawDays = json.optJSONArray("days");
            int[] days = new int[rawDays == null ? 0 : rawDays.length()];
            for (int index = 0; index < days.length; index++) days[index] = rawDays.optInt(index);
            return new ReadingReminderRecord(json.optString("id"), json.optBoolean("enabled", true),
                json.optInt("hour", 9), json.optInt("minute", 0), days,
                json.optString("targetType", "library"), json.optString("bookId", ""), json.optString("bookTitle", ""));
        }

        JSONObject toJson() {
            JSONObject json = new JSONObject();
            try {
                json.put("id", id); json.put("enabled", enabled); json.put("hour", hour); json.put("minute", minute);
                JSONArray rawDays = new JSONArray(); for (int day : days) rawDays.put(day); json.put("days", rawDays);
                json.put("targetType", targetType); json.put("bookId", bookId); json.put("bookTitle", bookTitle);
            } catch (Exception ignored) { }
            return json;
        }
    }
}
