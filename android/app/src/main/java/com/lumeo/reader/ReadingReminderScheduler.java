package com.lumeo.reader;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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

    static void arm(Context context, ReadingReminderRecord reminder) {
        if (reminder.days.length == 0 || !reminder.enabled) return;
        long next = nextOccurrence(reminder.hour, reminder.minute, reminder.days);
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pendingIntent(context, reminder.id));
        Log.i(TAG, "reminder.scheduled id=" + safe(reminder.id) + " nextTriggerAt=" + next);
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
