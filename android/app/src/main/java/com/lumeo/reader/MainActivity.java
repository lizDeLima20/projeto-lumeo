package com.lumeo.reader;

import com.getcapacitor.BridgeActivity;
import android.content.Intent;
import android.util.Log;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(NativeBookDownloadPlugin.class);
        registerPlugin(ReaderDisplayPlugin.class);
        registerPlugin(ReadingOpticsPlugin.class);
        registerPlugin(ReaderSoundPlugin.class);
        registerPlugin(ReadingReminderPlugin.class);
        super.onCreate(savedInstanceState);
        // Notification channels are created once by Android and retain their sound
        // configuration. Create the current version at startup so a saved reminder
        // is audible even before the user opens the Reader settings again.
        ReadingReminderScheduler.ensureNotificationChannel(this);
        // Android removes pending alarms when the application is updated. The saved
        // records remain private to the app, so reconcile them every launch.
        ReadingReminderScheduler.rescheduleFromSaved(this);
        Log.i("Lumeo", "android.launch package=com.lumeo.reader callback=com.lumeo.reader://auth/callback");
        handleReminderIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleReminderIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Re-evaluate after the user returns from Android's “Alarms & reminders”
        // special-access screen; this upgrades a saved fallback alarm to exact.
        ReadingReminderScheduler.rescheduleFromSaved(this);
    }

    private void handleReminderIntent(Intent intent) {
        if (intent == null || !"com.lumeo.reader.OPEN_READING_REMINDER".equals(intent.getAction())) return;
        String bookId = intent.getStringExtra("bookId");
        String route = bookId == null || bookId.trim().isEmpty()
            ? "https://localhost/library"
            : "https://localhost/reader?id=" + URLEncoder.encode(bookId, StandardCharsets.UTF_8);
        if (this.bridge == null || this.bridge.getWebView() == null) return;
        this.bridge.getWebView().post(() -> this.bridge.getWebView().loadUrl(route));
    }
}
