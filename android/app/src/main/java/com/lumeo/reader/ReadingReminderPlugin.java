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

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "ReadingReminder", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class ReadingReminderPlugin extends Plugin {
    @PluginMethod
    public void getState(PluginCall call) {
        ReadingReminderScheduler.ensureNotificationChannel(getContext());
        call.resolve(state());
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(permissionResult()); return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionResult");
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) { call.resolve(permissionResult()); }

    /** Backward-compatible one-reminder API used by older WebView bundles. */
    @PluginMethod
    public void schedule(PluginCall call) {
        ReadingReminderScheduler.ReadingReminderRecord record = parseRecord(call, null);
        if (record == null) return;
        List<ReadingReminderScheduler.ReadingReminderRecord> reminders = new ArrayList<>();
        reminders.add(record);
        ReadingReminderScheduler.replaceAll(getContext(), reminders);
        ReadingReminderScheduler.requestExactAlarmPermission(getActivity());
        call.resolve(state());
    }

    @PluginMethod
    public void saveReminders(PluginCall call) {
        JSArray raw = call.getArray("reminders");
        if (raw == null) { call.reject("INVALID_REMINDERS"); return; }
        List<ReadingReminderScheduler.ReadingReminderRecord> reminders = new ArrayList<>();
        try {
            for (int index = 0; index < raw.length(); index++) {
                JSONObject item = raw.getJSONObject(index);
                ReadingReminderScheduler.ReadingReminderRecord record = parseRecord(item);
                if (record == null) { call.reject("INVALID_REMINDER"); return; }
                reminders.add(record);
            }
        } catch (Exception error) { call.reject("INVALID_REMINDERS"); return; }
        ReadingReminderScheduler.replaceAll(getContext(), reminders);
        ReadingReminderScheduler.requestExactAlarmPermission(getActivity());
        call.resolve(state());
    }

    @PluginMethod
    public void deleteReminder(PluginCall call) {
        String id = call.getString("id", "");
        List<ReadingReminderScheduler.ReadingReminderRecord> next = new ArrayList<>();
        for (ReadingReminderScheduler.ReadingReminderRecord reminder : ReadingReminderScheduler.reminders(getContext()))
            if (!reminder.id.equals(id)) next.add(reminder);
        ReadingReminderScheduler.replaceAll(getContext(), next);
        call.resolve(state());
    }

    @PluginMethod
    public void setReminderEnabled(PluginCall call) {
        String id = call.getString("id", "");
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled"));
        List<ReadingReminderScheduler.ReadingReminderRecord> next = new ArrayList<>();
        for (ReadingReminderScheduler.ReadingReminderRecord reminder : ReadingReminderScheduler.reminders(getContext())) {
            next.add(reminder.id.equals(id) ? new ReadingReminderScheduler.ReadingReminderRecord(reminder.id, enabled, reminder.hour, reminder.minute, reminder.days, reminder.targetType, reminder.bookId, reminder.bookTitle) : reminder);
        }
        ReadingReminderScheduler.replaceAll(getContext(), next);
        ReadingReminderScheduler.requestExactAlarmPermission(getActivity());
        call.resolve(state());
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        ReadingReminderScheduler.replaceAll(getContext(), new ArrayList<>());
        call.resolve(state());
    }

    private ReadingReminderScheduler.ReadingReminderRecord parseRecord(PluginCall call, String id) {
        Integer hour = call.getInt("hour"), minute = call.getInt("minute");
        JSArray rawDays = call.getArray("days");
        Boolean enabled = call.getBoolean("enabled", true);
        if (hour == null || minute == null || rawDays == null || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            call.reject("INVALID_REMINDER"); return null;
        }
        int[] days = days(rawDays); if (days == null || days.length == 0) { call.reject("REMINDER_REQUIRES_DAY"); return null; }
        return new ReadingReminderScheduler.ReadingReminderRecord(id, enabled, hour, minute, days,
            call.getString("targetType", "library"), call.getString("bookId", ""), call.getString("bookTitle", ""));
    }

    private ReadingReminderScheduler.ReadingReminderRecord parseRecord(JSONObject item) {
        JSONArray rawDays = item.optJSONArray("days");
        Integer hour = item.has("hour") ? item.optInt("hour") : null, minute = item.has("minute") ? item.optInt("minute") : null;
        if (hour == null || minute == null || rawDays == null || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
        int[] days = days(rawDays); if (days == null || days.length == 0) return null;
        return new ReadingReminderScheduler.ReadingReminderRecord(item.optString("id", null), item.optBoolean("enabled", true), hour, minute, days,
            item.optString("targetType", "library"), item.optString("bookId", ""), item.optString("bookTitle", ""));
    }

    private int[] days(JSArray rawDays) {
        try {
            int[] days = new int[rawDays.length()];
            for (int index = 0; index < rawDays.length(); index++) {
                int day = rawDays.getInt(index);
                if (day < 1 || day > 7) return null;
                days[index] = day;
            }
            return days;
        } catch (Exception error) { return null; }
    }

    private int[] days(JSONArray rawDays) {
        try {
            int[] days = new int[rawDays.length()];
            for (int index = 0; index < rawDays.length(); index++) {
                int day = rawDays.optInt(index);
                if (day < 1 || day > 7) return null;
                days[index] = day;
            }
            return days;
        } catch (Exception error) { return null; }
    }

    private JSObject permissionResult() {
        JSObject result = new JSObject();
        result.put("granted", Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED);
        return result;
    }

    private JSObject state() {
        List<ReadingReminderScheduler.ReadingReminderRecord> reminders = ReadingReminderScheduler.reminders(getContext());
        JSArray array = new JSArray();
        for (ReadingReminderScheduler.ReadingReminderRecord reminder : reminders) array.put(reminder.toJson());
        JSObject result = new JSObject();
        boolean enabled = false; for (ReadingReminderScheduler.ReadingReminderRecord reminder : reminders) enabled = enabled || reminder.enabled;
        result.put("enabled", enabled);
        ReadingReminderScheduler.ReadingReminderRecord first = reminders.isEmpty() ? new ReadingReminderScheduler.ReadingReminderRecord("", false, 9, 0, new int[]{1,2,3,4,5,6,7}, "library", "", "") : reminders.get(0);
        result.put("hour", first.hour); result.put("minute", first.minute); result.put("days", JSArray.from(first.days));
        result.put("reminders", array);
        return result;
    }
}
