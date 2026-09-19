package com.lumeo.reader;

import com.getcapacitor.BridgeActivity;
import android.util.Log;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(NativeBookDownloadPlugin.class);
        registerPlugin(ReaderDisplayPlugin.class);
        registerPlugin(ReadingReminderPlugin.class);
        super.onCreate(savedInstanceState);
        Log.i("Lumeo", "android.launch package=com.lumeo.reader callback=com.lumeo.reader://auth/callback");
    }
}
