package com.lumeo.reader;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Plays short Reader cues outside the WebView. A timer callback is not a user
 * gesture, so relying on HTMLAudio there is unreliable on Android WebView.
 */
@CapacitorPlugin(name = "ReaderSound")
public class ReaderSoundPlugin extends Plugin {
    private static final String TAG = "Lumeo";

    @PluginMethod
    public void playReadingFinished(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            MediaPlayer player = null;
            try {
                AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
                AudioAttributes attributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
                if (audio != null) requestFocus(audio, attributes);
                player = MediaPlayer.create(getContext(), R.raw.fim_da_leitura, attributes, 0);
                if (player == null) { call.reject("READER_SOUND_UNAVAILABLE"); return; }
                final MediaPlayer completed = player;
                player.setOnCompletionListener(value -> { value.release(); abandonFocus(audio); });
                player.setOnErrorListener((value, what, extra) -> { Log.w(TAG, "pomodoro.sound.error=" + what); value.release(); abandonFocus(audio); return true; });
                completed.start();
                Log.i(TAG, "pomodoro.sound.played");
                call.resolve();
            } catch (Exception error) {
                if (player != null) player.release();
                Log.w(TAG, "pomodoro.sound.failed", error);
                call.reject("READER_SOUND_FAILED");
            }
        });
    }

    private void requestFocus(AudioManager audio, AudioAttributes attributes) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audio.requestAudioFocus(new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attributes).setAcceptsDelayedFocusGain(false).build());
        } else audio.requestAudioFocus(null, AudioManager.STREAM_NOTIFICATION, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
    }

    private void abandonFocus(AudioManager audio) {
        if (audio == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) audio.abandonAudioFocusRequest(new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).build());
        else audio.abandonAudioFocus(null);
    }
}
