package com.beileme.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BeilemeSpeechPlugin.class);
        super.onCreate(savedInstanceState);
        // Word pronunciation starts when a learning card appears, using our Kokoro audio.
        // Users can disable automatic pronunciation in the learning screen.
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}
