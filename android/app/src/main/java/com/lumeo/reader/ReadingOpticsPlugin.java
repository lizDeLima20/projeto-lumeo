package com.lumeo.reader;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.SystemClock;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native, session-only optical guidance for the text Reader.
 *
 * It never changes system brightness, colour temperature or user settings.  The light sensor
 * is active only while ReaderView asks for it and produces a slow, bounded paper/ink profile
 * for the WebView. Android has no public per-window gamma or colour-temperature API, so those
 * controls deliberately stay untouched instead of using an invasive display-wide workaround.
 */
@CapacitorPlugin(name = "ReadingOptics")
public class ReadingOpticsPlugin extends Plugin implements SensorEventListener {
    private static final String TAG = "ReadingOptics";
    private static final float MIN_LUX = 0f;
    private static final float MAX_LUX = 100_000f;
    private static final long MIN_UPDATE_MS = 7_500L;
    private static final float SMOOTHING = .12f;
    private static final float LOG_HYSTERESIS = .16f;

    private SensorManager sensorManager;
    private Sensor lightSensor;
    private boolean active = false;
    private float filteredLux = -1f;
    private float emittedLux = -1f;
    private long lastEmissionAt = 0L;

    @PluginMethod
    public void start(PluginCall call) {
        active = true;
        filteredLux = -1f;
        emittedLux = -1f;
        lastEmissionAt = 0L;
        sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        lightSensor = sensorManager == null ? null : sensorManager.getDefaultSensor(Sensor.TYPE_LIGHT);
        if (lightSensor == null) {
            JSObject fallback = profile(120f, false);
            Log.i(TAG, "READING_OPTICS_FALLBACK sensorAvailable=false");
            call.resolve(fallback);
            notifyListeners("profile", fallback);
            return;
        }
        sensorManager.registerListener(this, lightSensor, SensorManager.SENSOR_DELAY_NORMAL);
        JSObject initial = profile(120f, true);
        Log.i(TAG, "READING_OPTICS_STARTED sensorAvailable=true");
        call.resolve(initial);
        notifyListeners("profile", initial);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopListening();
        call.resolve();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject state = new JSObject();
        state.put("active", active);
        state.put("sensorAvailable", lightSensor != null);
        state.put("lux", filteredLux < 0f ? null : Math.round(filteredLux));
        call.resolve(state);
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (!active || event.values.length == 0) return;
        float lux = clamp(event.values[0], MIN_LUX, MAX_LUX);
        filteredLux = filteredLux < 0f ? lux : (SMOOTHING * lux) + ((1f - SMOOTHING) * filteredLux);
        long now = SystemClock.elapsedRealtime();
        if (shouldEmit(now)) emit(now);
    }

    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { /* sensor noise is filtered above */ }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        unregisterOnly();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (active && lightSensor != null && sensorManager != null) {
            sensorManager.registerListener(this, lightSensor, SensorManager.SENSOR_DELAY_NORMAL);
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopListening();
        super.handleOnDestroy();
    }

    private boolean shouldEmit(long now) {
        if (emittedLux < 0f) return true;
        if (now - lastEmissionAt < MIN_UPDATE_MS) return false;
        float current = (float) Math.log1p(filteredLux);
        float prior = (float) Math.log1p(emittedLux);
        return Math.abs(current - prior) >= LOG_HYSTERESIS;
    }

    private void emit(long now) {
        emittedLux = filteredLux;
        lastEmissionAt = now;
        JSObject value = profile(filteredLux, true);
        Log.i(TAG, "READING_OPTICS_PROFILE luxBucket=" + value.getInteger("luxBucket") + " paperWeight=" + value.getInteger("paperWeight"));
        notifyListeners("profile", value);
    }

    /** A logarithmic response avoids a bright jump between dim and normal indoor light. */
    private JSObject profile(float lux, boolean sensorAvailable) {
        float normalizedBrightness = clamp(.26f + (.082f * (float) Math.log1p(lux)), .26f, .88f);
        float ratio = (normalizedBrightness - .26f) / .62f;
        int paperWeight = Math.round(91f + (ratio * 9f));
        int inkWeight = Math.round(96f + (ratio * 4f));
        JSObject value = new JSObject();
        value.put("sensorAvailable", sensorAvailable);
        value.put("luxBucket", luxBucket(lux));
        value.put("paperWeight", paperWeight);
        value.put("inkWeight", inkWeight);
        value.put("recommendedBrightness", Math.round(normalizedBrightness * 100f));
        return value;
    }

    private int luxBucket(float lux) {
        if (lux < 10f) return 0;
        if (lux < 100f) return 1;
        if (lux < 1_000f) return 2;
        if (lux < 10_000f) return 3;
        return 4;
    }

    private static float clamp(float value, float min, float max) { return Math.max(min, Math.min(max, value)); }
    private void unregisterOnly() { if (sensorManager != null) sensorManager.unregisterListener(this); }
    private void stopListening() { active = false; unregisterOnly(); filteredLux = -1f; emittedLux = -1f; lastEmissionAt = 0L; Log.i(TAG, "READING_OPTICS_STOPPED"); }
}
