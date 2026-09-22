package com.lumeo.reader;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import java.util.List;

public final class ReadingReminderReceiver extends BroadcastReceiver {
    private static final String TAG = "ReadingReminder";

    @Override public void onReceive(Context context, Intent intent) {
        String id = intent.getStringExtra(ReadingReminderScheduler.EXTRA_REMINDER_ID);
        ReadingReminderScheduler.ReadingReminderRecord reminder = find(context, id);
        if (reminder == null || !reminder.enabled) {
            Log.w(TAG, "REMINDER_ERROR stage=record_missing_or_disabled");
            ReadingReminderScheduler.rescheduleFromSaved(context);
            return;
        }
        Log.i(TAG, "REMINDER_RECEIVED id=" + ReadingReminderScheduler.safe(id));
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            Log.e(TAG, "REMINDER_ERROR stage=notification_manager_unavailable");
        } else if (!manager.areNotificationsEnabled()) {
            Log.e(TAG, "REMINDER_ERROR stage=notifications_disabled");
        } else {
            ReadingReminderScheduler.ensureNotificationChannel(context);
            Uri sound = Uri.parse("android.resource://" + context.getPackageName() + "/raw/notificacao_lembrete");
            Intent open = new Intent(context, MainActivity.class)
                .setAction("com.lumeo.reader.OPEN_READING_REMINDER")
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            if ("book".equals(reminder.targetType)) open.putExtra("bookId", reminder.bookId);
            PendingIntent content = PendingIntent.getActivity(context, ReadingReminderScheduler.requestCode(reminder.id) + 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            android.app.Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new android.app.Notification.Builder(context, ReadingReminderScheduler.CHANNEL_ID) : new android.app.Notification.Builder(context);
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) builder.setSound(sound);
            android.app.Notification notification = builder.setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle("Hora da sua leitura")
                .setContentText("book".equals(reminder.targetType) && !reminder.bookTitle.isEmpty() ? "Continuar “" + reminder.bookTitle + "”" : "Que tal continuar sua leitura?")
                .setContentIntent(content).setAutoCancel(true).setOnlyAlertOnce(false).setPriority(android.app.Notification.PRIORITY_MAX).setCategory(android.app.Notification.CATEGORY_ALARM).build();
            notification.flags |= android.app.Notification.FLAG_INSISTENT;
            manager.notify(ReadingReminderScheduler.requestCode(reminder.id), notification);
            Log.i(TAG, "REMINDER_NOTIFICATION_CREATED id=" + ReadingReminderScheduler.safe(id));
            // On Android 8+, the system owns playback. This means the channel's
            // bundled MP3 is now handed to Android rather than HTMLAudio/WebView.
            Log.i(TAG, "REMINDER_SOUND_STARTED channel=" + ReadingReminderScheduler.CHANNEL_ID);
        }
        ReadingReminderScheduler.rescheduleFromSaved(context);
    }

    private ReadingReminderScheduler.ReadingReminderRecord find(Context context, String id) {
        List<ReadingReminderScheduler.ReadingReminderRecord> reminders = ReadingReminderScheduler.reminders(context);
        for (ReadingReminderScheduler.ReadingReminderRecord reminder : reminders) if (reminder.id.equals(id)) return reminder;
        return reminders.isEmpty() ? null : reminders.get(0);
    }
}
