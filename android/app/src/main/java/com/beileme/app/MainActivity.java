package com.beileme.app;

import android.os.Bundle;
import android.os.Build;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BeilemeSpeechPlugin.class);
        super.onCreate(savedInstanceState);
        // Draw the shared landscape behind system icons; SystemBars supplies safe
        // insets to CSS so controls stay clear of cutouts and gesture navigation.
        WindowCompat.enableEdgeToEdge(getWindow());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attributes);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
        // Word pronunciation starts when a learning card appears, using our Kokoro audio.
        // Users can disable automatic pronunciation in the learning screen.
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}
