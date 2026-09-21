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
        registerPlugin(ReadingReminderPlugin.class);
        super.onCreate(savedInstanceState);
        Log.i("Lumeo", "android.launch package=com.lumeo.reader callback=com.lumeo.reader://auth/callback");
        handleReminderIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleReminderIntent(intent);
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
