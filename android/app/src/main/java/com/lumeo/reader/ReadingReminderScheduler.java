package com.lumeo.reader;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

import java.util.Calendar;

/**
 * The one place that knows how to turn "this time, these weekdays" into the next alarm.
 * Used by the plugin (first schedule), the receiver (reschedule itself after firing) and the
 * boot receiver (AlarmManager alarms do not survive a reboot, so this puts them back).
 *
 * Deliberately not exact: "hora da leitura" tolerating a few minutes of drift is a fair
 * trade for never needing the SCHEDULE_EXACT_ALARM permission screen.
 */
final class ReadingReminderScheduler {
    static final String PREFS = "lumeo_reading_reminder";
    private static final String TAG = "ReadingReminder";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_HOUR = "hour";
    private static final String KEY_MINUTE = "minute";
    private static final String KEY_DAYS = "days"; // comma-separated Calendar.DAY_OF_WEEK values (1=Sunday..7=Saturday)

    private ReadingReminderScheduler() {}

    static void save(Context context, boolean enabled, int hour, int minute, int[] days) {
        StringBuilder joined = new StringBuilder();
        for (int i = 0; i < days.length; i++) { if (i > 0) joined.append(','); joined.append(days[i]); }
        prefs(context).edit()
            .putBoolean(KEY_ENABLED, enabled)
            .putInt(KEY_HOUR, hour)
            .putInt(KEY_MINUTE, minute)
            .putString(KEY_DAYS, joined.toString())
            .apply();
    }

    static SharedPreferences prefs(Context context) { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static boolean isEnabled(Context context) { return prefs(context).getBoolean(KEY_ENABLED, false); }
    static int hour(Context context) { return prefs(context).getInt(KEY_HOUR, 9); }
    static int minute(Context context) { return prefs(context).getInt(KEY_MINUTE, 0); }
    static int[] days(Context context) {
        String raw = prefs(context).getString(KEY_DAYS, "1,2,3,4,5,6,7");
        String[] parts = raw.isEmpty() ? new String[0] : raw.split(",");
        int[] values = new int[parts.length];
        for (int i = 0; i < parts.length; i++) values[i] = Integer.parseInt(parts[i].trim());
        return values;
    }

    /** Re-arms from whatever is currently saved (boot, or right after a reminder just fired). */
    static void rescheduleFromSaved(Context context) {
        if (!isEnabled(context)) return;
        arm(context, hour(context), minute(context), days(context));
    }

    static void cancel(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(pendingIntent(context));
    }

    static void arm(Context context, int hour, int minute, int[] days) {
        if (days.length == 0) { Log.i(TAG, "reminder.schedule skipped: no days selected"); return; }
        long next = nextOccurrence(hour, minute, days);
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pendingIntent(context));
        Log.i(TAG, "reminder.scheduled nextTriggerAt=" + next);
    }

    private static PendingIntent pendingIntent(Context context) {
        Intent intent = new Intent(context, ReadingReminderReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, 1001, intent, flags);
    }

    /** The next moment, today or up to 6 days out, that matches one of the selected weekdays
     *  at hour:minute and is still in the future. */
    private static long nextOccurrence(int hour, int minute, int[] days) {
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
        // No matching weekday found in a week (should not happen with a non-empty selection):
        // fall back to the same time tomorrow rather than never firing again.
        Calendar fallback = (Calendar) now.clone();
        fallback.add(Calendar.DAY_OF_YEAR, 1);
        fallback.set(Calendar.HOUR_OF_DAY, hour); fallback.set(Calendar.MINUTE, minute);
        fallback.set(Calendar.SECOND, 0); fallback.set(Calendar.MILLISECOND, 0);
        return fallback.getTimeInMillis();
    }
}
