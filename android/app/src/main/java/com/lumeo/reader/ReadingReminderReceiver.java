package com.lumeo.reader;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

import java.util.List;

public final class ReadingReminderReceiver extends BroadcastReceiver {
    private static final String CHANNEL_ID = "lumeo_reading_reminder_v2";

    @Override public void onReceive(Context context, Intent intent) {
        String id = intent.getStringExtra(ReadingReminderScheduler.EXTRA_REMINDER_ID);
        ReadingReminderScheduler.ReadingReminderRecord reminder = find(context, id);
        if (reminder == null || !reminder.enabled) { ReadingReminderScheduler.rescheduleFromSaved(context); return; }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) {
            Uri sound = Uri.parse("android.resource://" + context.getPackageName() + "/" + R.raw.notificacao_lembrete);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Lembrete de leitura", NotificationManager.IMPORTANCE_HIGH);
                channel.setSound(sound, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
                channel.enableVibration(true);
                manager.createNotificationChannel(channel);
            }
            Intent open = new Intent(context, MainActivity.class)
                .setAction("com.lumeo.reader.OPEN_READING_REMINDER")
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            if ("book".equals(reminder.targetType)) open.putExtra("bookId", reminder.bookId);
            PendingIntent content = PendingIntent.getActivity(context, ReadingReminderScheduler.requestCode(reminder.id) + 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            android.app.Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new android.app.Notification.Builder(context, CHANNEL_ID) : new android.app.Notification.Builder(context);
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) builder.setSound(sound);
            android.app.Notification notification = builder.setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle("Hora da sua leitura")
                .setContentText("book".equals(reminder.targetType) && !reminder.bookTitle.isEmpty() ? "Continuar “" + reminder.bookTitle + "”" : "Que tal continuar sua leitura?")
                .setContentIntent(content).setAutoCancel(true).setPriority(android.app.Notification.PRIORITY_MAX).setCategory(android.app.Notification.CATEGORY_ALARM).build();
            notification.flags |= android.app.Notification.FLAG_INSISTENT;
            manager.notify(ReadingReminderScheduler.requestCode(reminder.id), notification);
        }
        ReadingReminderScheduler.rescheduleFromSaved(context);
    }

    private ReadingReminderScheduler.ReadingReminderRecord find(Context context, String id) {
        List<ReadingReminderScheduler.ReadingReminderRecord> reminders = ReadingReminderScheduler.reminders(context);
        for (ReadingReminderScheduler.ReadingReminderRecord reminder : reminders) if (reminder.id.equals(id)) return reminder;
        return reminders.isEmpty() ? null : reminders.get(0);
    }
}
