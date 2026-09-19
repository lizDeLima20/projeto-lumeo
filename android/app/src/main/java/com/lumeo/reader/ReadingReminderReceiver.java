package com.lumeo.reader;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Fires even with the WebView stopped, then immediately schedules the next selected weekday. */
public final class ReadingReminderReceiver extends BroadcastReceiver {
    private static final String CHANNEL_ID = "lumeo_reading_reminder";

    @Override public void onReceive(Context context, Intent ignored) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "Lembrete de leitura", NotificationManager.IMPORTANCE_DEFAULT));
            }
            Intent open = new Intent(context, MainActivity.class).setAction("com.lumeo.reader.OPEN_LIBRARY").addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent content = PendingIntent.getActivity(context, 1002, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            android.app.Notification.Builder notification = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new android.app.Notification.Builder(context, CHANNEL_ID) : new android.app.Notification.Builder(context);
            manager.notify(1001, notification.setSmallIcon(android.R.drawable.ic_popup_reminder).setContentTitle("Hora da sua leitura")
                .setContentText("Que tal continuar seu livro?").setContentIntent(content).setAutoCancel(true).build());
        }
        ReadingReminderScheduler.rescheduleFromSaved(context);
    }
}
