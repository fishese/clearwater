package com.fishese.clearwater;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ClearWaterFilesPlugin.class);
        registerPlugin(ClearWaterHdrPlugin.class);
        registerPlugin(ClearWaterBackPlugin.class);
        registerPlugin(ClearWaterCameraPlugin.class);
        registerPlugin(ClearWaterSharePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
