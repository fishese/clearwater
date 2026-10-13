package com.fishese.clearwater;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ClearWaterBack")
public class ClearWaterBackPlugin extends Plugin {
    private OnBackPressedCallback backCallback;

    @Override
    public void load() {
        backCallback = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
                notifyListeners("back", new JSObject());
            }
        };
        getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), backCallback);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (backCallback == null || enabled == null) {
            call.reject("Back handler is unavailable.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (backCallback == null) {
                call.reject("Back handler is unavailable.");
                return;
            }
            backCallback.setEnabled(enabled);
            call.resolve();
        });
    }

    @PluginMethod
    public void exitApp(PluginCall call) {
        if (backCallback == null || !backCallback.isEnabled()) {
            call.reject("Back handler is not active.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            getActivity().finishAndRemoveTask();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (backCallback != null) {
            backCallback.remove();
            backCallback = null;
        }
        super.handleOnDestroy();
    }
}
