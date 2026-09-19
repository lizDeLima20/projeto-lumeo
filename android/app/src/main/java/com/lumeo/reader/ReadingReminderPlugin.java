package com.lumeo.reader;

import android.Manifest;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Native scheduling is deliberately kept here: a WebView timer cannot fire while Lumeo is closed. */
@CapacitorPlugin(name = "ReadingReminder", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class ReadingReminderPlugin extends Plugin {
    @PluginMethod
    public void getState(PluginCall call) { call.resolve(state()); }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(permissionResult()); return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionResult");
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) { call.resolve(permissionResult()); }

    @PluginMethod
    public void schedule(PluginCall call) {
        Integer hour = call.getInt("hour"), minute = call.getInt("minute");
        JSArray rawDays = call.getArray("days");
        if (hour == null || minute == null || rawDays == null || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            call.reject("INVALID_REMINDER"); return;
        }
        int[] days = new int[rawDays.length()];
        try {
            for (int index = 0; index < rawDays.length(); index++) {
                int day = rawDays.getInt(index);
                if (day < 1 || day > 7) { call.reject("INVALID_REMINDER_DAY"); return; }
                days[index] = day;
            }
        } catch (Exception error) { call.reject("INVALID_REMINDER_DAY"); return; }
        if (days.length == 0) { call.reject("REMINDER_REQUIRES_DAY"); return; }
        ReadingReminderScheduler.save(getContext(), true, hour, minute, days);
        ReadingReminderScheduler.cancel(getContext());
        ReadingReminderScheduler.arm(getContext(), hour, minute, days);
        call.resolve(state());
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        ReadingReminderScheduler.cancel(getContext());
        ReadingReminderScheduler.save(getContext(), false, ReadingReminderScheduler.hour(getContext()), ReadingReminderScheduler.minute(getContext()), ReadingReminderScheduler.days(getContext()));
        call.resolve(state());
    }

    private JSObject permissionResult() {
        JSObject result = new JSObject();
        result.put("granted", Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED);
        return result;
    }

    private JSObject state() {
        JSObject result = new JSObject();
        result.put("enabled", ReadingReminderScheduler.isEnabled(getContext()));
        result.put("hour", ReadingReminderScheduler.hour(getContext()));
        result.put("minute", ReadingReminderScheduler.minute(getContext()));
        result.put("days", JSArray.from(ReadingReminderScheduler.days(getContext())));
        return result;
    }
}
