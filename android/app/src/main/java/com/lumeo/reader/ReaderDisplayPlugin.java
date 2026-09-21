package com.lumeo.reader;

import android.app.Activity;
import android.util.Log;
import android.view.Window;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reading brightness for the Lumeo window only.
 *
 * It sets WindowManager.LayoutParams.screenBrightness on this Activity's window, which
 * Android honours only while the window is in front. The global brightness setting is
 * never written, so WRITE_SETTINGS is not needed and nothing outlives the app: in the
 * background, on another app or after the process ends the phone is at its own level.
 */
@CapacitorPlugin(name = "ReaderDisplay")
public class ReaderDisplayPlugin extends Plugin {
    private static final String TAG = "ReaderDisplay";
    /** Lowest level offered: dimmer than most phones' own minimum, still legible in the dark. */
    static final float MIN_BRIGHTNESS = 0.02f;

    /** The level the Reader asked for, or null when the system level applies. */
    private Float readerBrightness = null;

    @PluginMethod
    public void setReaderBrightness(PluginCall call) {
        Double value = call.getDouble("value");
        if (value == null || value.isNaN()) {
            call.reject("INVALID_BRIGHTNESS");
            return;
        }
        readerBrightness = clamp(value.floatValue());
        apply(call);
    }

    @PluginMethod
    public void restoreSystemBrightness(PluginCall call) {
        readerBrightness = null;
        apply(call);
    }

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("readerBrightness", readerBrightness);
        call.resolve(result);
    }

    /** A recreated Activity (rotation, theme change) gets a new window: re-apply the level. */
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (readerBrightness != null) apply(null);
    }

    /** Leaving nothing behind: the window override goes with the window. */
    @Override
    protected void handleOnDestroy() {
        readerBrightness = null;
        super.handleOnDestroy();
    }

    static float clamp(float value) {
        return Math.max(MIN_BRIGHTNESS, Math.min(1f, value));
    }

    private void apply(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            if (call != null) call.reject("NO_ACTIVITY");
            return;
        }
        final Float level = readerBrightness;
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            WindowManager.LayoutParams params = window.getAttributes();
            params.screenBrightness = level == null ? WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE : level;
            window.setAttributes(params);
            Log.i(TAG, "reader.brightness " + (level == null ? "system" : String.format(java.util.Locale.ROOT, "%.2f", level)));
            if (call != null) {
                JSObject result = new JSObject();
                result.put("readerBrightness", level);
                call.resolve(result);
            }
        });
    }
}
