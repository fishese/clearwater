package com.fishese.clearwater;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ClearWaterFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
