package com.lumeo.reader;

import android.app.Activity;
import android.util.Log;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Full-screen reading for the Lumeo window only, while the Comic Reader asks for it.
 *
 * Lets the window draw edge-to-edge and hides the status/navigation bars, so a comic page
 * reclaims the strip of screen those bars would otherwise reserve. A swipe from either edge
 * still reveals them for a moment - Android's own transient-bars gesture - so the device's
 * own navigation is never actually taken away, only out of the way by default. Nothing is
 * written to a system setting: the override belongs to this window alone, and the bars
 * return on their own the moment the Reader asks to leave or the window goes away.
 */
@CapacitorPlugin(name = "ReaderImmersive")
public class ReaderImmersivePlugin extends Plugin {
    private static final String TAG = "ReaderImmersive";

    /** Whether the Reader currently wants the full-screen layout. */
    private boolean immersive = false;

    @PluginMethod
    public void enter(PluginCall call) {
        immersive = true;
        apply(call);
    }

    @PluginMethod
    public void exit(PluginCall call) {
        immersive = false;
        apply(call);
    }

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("immersive", immersive);
        call.resolve(result);
    }

    /** A recreated Activity (rotation, theme change) gets a new window/controller: the
     *  override does not survive it on its own, so re-apply when the Reader is still open. */
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (immersive) apply(null);
    }

    /** Leaving nothing behind: the window override goes with the window. */
    @Override
    protected void handleOnDestroy() {
        immersive = false;
        super.handleOnDestroy();
    }

    private void apply(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            if (call != null) call.reject("NO_ACTIVITY");
            return;
        }
        final boolean on = immersive;
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            WindowCompat.setDecorFitsSystemWindows(window, !on);
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            if (controller != null) {
                controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                if (on) controller.hide(WindowInsetsCompat.Type.systemBars());
                else controller.show(WindowInsetsCompat.Type.systemBars());
            }
            Log.i(TAG, "reader.immersive " + on);
            if (call != null) {
                JSObject result = new JSObject();
                result.put("immersive", on);
                call.resolve(result);
            }
        });
    }
}
