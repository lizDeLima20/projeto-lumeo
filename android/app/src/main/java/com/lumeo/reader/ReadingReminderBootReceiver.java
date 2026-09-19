package com.lumeo.reader;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** AlarmManager schedules are cleared by reboot, so restore only the user's already-enabled reminder. */
public final class ReadingReminderBootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) ReadingReminderScheduler.rescheduleFromSaved(context);
    }
}
