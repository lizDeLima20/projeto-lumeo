package com.lumeo.reader;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(NativeBookDownloadPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
