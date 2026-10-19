package com.fishese.clearwater;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.drawable.Drawable;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.graphics.ImageFormat;
import android.hardware.display.DisplayManager;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.CaptureResult;
import android.hardware.camera2.TotalCaptureResult;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.graphics.YuvImage;
import android.net.Uri;
import android.media.ExifInterface;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Range;
import android.util.Size;
import android.util.Log;
import android.view.Display;
import android.view.OrientationEventListener;
import android.view.Surface;
import android.view.View;
import android.view.ViewGroup;
import android.view.Gravity;
import android.view.WindowManager;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.activity.result.ActivityResult;
import androidx.annotation.NonNull;
import androidx.camera.camera2.interop.Camera2CameraInfo;
import androidx.camera.camera2.interop.Camera2Interop;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraEffect;
import androidx.camera.core.CameraInfo;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.core.UseCaseGroup;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.media3.effect.Media3Effect;
import androidx.camera.video.FileOutputOptions;
import androidx.camera.video.FallbackStrategy;
import androidx.camera.video.PendingRecording;
import androidx.camera.video.Quality;
import androidx.camera.video.QualitySelector;
import androidx.camera.video.Recorder;
import androidx.camera.video.Recording;
import androidx.camera.video.VideoCapture;
import androidx.camera.video.VideoRecordEvent;
import androidx.camera.view.PreviewView;
import androidx.coordinatorlayout.widget.CoordinatorLayout;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.LifecycleOwner;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONObject;

/** CameraX capture session used by the Android camera screen. */
@CapacitorPlugin(name = "ClearWaterCamera", permissions = {
    @Permission(alias = "camera", strings = {Manifest.permission.CAMERA}),
    @Permission(alias = "microphone", strings = {Manifest.permission.RECORD_AUDIO})
})
public class ClearWaterCameraPlugin extends Plugin {
    private Executor mainExecutor;
    private final ExecutorService analysisExecutor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, Lens> lenses = new LinkedHashMap<>();
    private static final Map<String, File> temporaryCaptures = new HashMap<>();
    private static final long MAX_PHYSICAL_JPEG_PIXELS = 12_500_000L;

    /** Open only a live registered video before release can remove its ownership. */
    static void copyOwnedVideoCapture(Context context, String sourceUri, OutputStream output) throws IOException {
        FileInputStream input;
        synchronized(temporaryCaptures) {
            File source=temporaryCaptures.get(sourceUri);
            File directory=new File(context.getCacheDir(),"camera-captures").getCanonicalFile();
            if(source==null||!source.getCanonicalFile().getParentFile().equals(directory)||
                !source.getName().endsWith(".mp4")||!Uri.fromFile(source).toString().equals(sourceUri)||
                !source.isFile()||source.length()<=0)throw new IOException("That video is not an owned temporary camera capture.");
            input=new FileInputStream(source);
        }
        try(input) {
            byte[] buffer=new byte[65536];int count;
            while((count=input.read(buffer))!=-1)output.write(buffer,0,count);
        }
    }
    private ProcessCameraProvider provider;
    private PreviewView previewView;
    private ViewGroup previewParent;
    private Drawable savedWebViewBackground;
    private boolean hasSavedWebViewBackground;
    private boolean keepScreenOnWasAlreadySet;
    private boolean changedKeepScreenOn;
    private Camera camera;
    private Preview preview;
    private ImageCapture imageCapture;
    private ImageAnalysis imageAnalysis;
    private VideoCapture<Recorder> videoCapture;
    private Media3Effect media3Effect;
    private long media3EffectGeneration;
    private Recording recording;
    private File recordingFile;
    private boolean recordingDiscard;
    private boolean recordingActive;
    private long recordingMaxBytes;
    private long recordingMaxAt;
    private final Runnable recordingLimitCheck = new Runnable() {
        @Override public void run() {
            if (!recordingActive || recording == null) return;
            if ((recordingMaxAt > 0 && SystemClock.elapsedRealtime() >= recordingMaxAt)
                || (recordingMaxBytes > 0 && recordingFile != null && recordingFile.length() >= recordingMaxBytes)) {
                recording.stop(); return;
            }
            main.postDelayed(this, 500);
        }
    };
    private boolean sessionActive;
    private long sessionGeneration;
    private long bindGeneration;
    private PluginCall pendingSessionCall;
    private PluginCall pendingBindCall;
    private PluginCall pendingRecordingPermissionCall;
    private boolean microphoneRequested;
    private String facing = "environment";
    private String quality = "standard";
    private String selectedLensId;
    private String lastBoundLensId;
    private boolean resetZoomForLensSwitch;
    private JSONObject recipe = new JSONObject();
    private String latestSampleData;
    private int latestSampleWidth;
    private int latestSampleHeight;
    private long lastSampleAt;
    private volatile long analysisGeneration;
    private int minZoom = 1;
    private int maxZoom = 1;
    private float previewPixelRatio = 1f;
    private String launchMode;
    // CameraX rotation for captured media. Unlike Display.getRotation(), this
    // follows the physical device while system auto-rotate is locked.
    private int captureRotation = Surface.ROTATION_0;
    private int previousRequestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private boolean savedRequestedOrientation;

    @Override public void load() {
        super.load();
        consumeLaunchIntent(getActivity().getIntent(), false);
    }

    @Override protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        consumeLaunchIntent(intent, true);
    }

    private void consumeLaunchIntent(Intent intent, boolean notify) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri uri = intent.getData();
        if (uri == null || !"clearwater".equalsIgnoreCase(uri.getScheme())) return;
        String host = uri.getHost();
        if (!"camera".equalsIgnoreCase(host) && !"edit".equalsIgnoreCase(host)) return;
        String mode = host.toLowerCase(java.util.Locale.ROOT);
        if (!notify) launchMode = mode;
        // Keep this launch action in memory for getLaunchMode(), but prevent an activity
        // recreation or WebView reload from replaying the original intent.
        intent.setAction(null); intent.setData(null);
        if (notify) { JSObject value = new JSObject(); value.put("mode", mode); notifyListeners("launchMode", value, true); }
    }
    private OrientationEventListener orientationListener;

    private static final class Lens {
        final String id, label, facing;
        final String physicalCameraId;
        final String logicalCameraId;
        final CameraInfo info;
        final float intrinsicZoom;
        final float metadataMinZoom, metadataMaxZoom;
        Lens(String id, String label, String facing, String physicalCameraId, String logicalCameraId, CameraInfo info, float intrinsicZoom,
             float metadataMinZoom, float metadataMaxZoom) {
            this.id=id; this.label=label; this.facing=facing; this.physicalCameraId=physicalCameraId;
            this.logicalCameraId=logicalCameraId; this.info=info; this.intrinsicZoom=intrinsicZoom;
            this.metadataMinZoom=metadataMinZoom;this.metadataMaxZoom=metadataMaxZoom;
        }
        boolean physical() { return physicalCameraId != null; }
        CameraSelector selector() {
            if (physical()) return new CameraSelector.Builder()
                .requireLensFacing("user".equals(facing) ? CameraSelector.LENS_FACING_FRONT : CameraSelector.LENS_FACING_BACK)
                .addCameraFilter(cameraInfos -> {
                    List<CameraInfo> matching=new ArrayList<>();
                    for(CameraInfo candidate:cameraInfos)try {
                        if(logicalCameraId.equals(Camera2CameraInfo.from(candidate).getCameraId()))matching.add(candidate);
                    }catch(Exception ignored){}
                    return matching;
                })
                .setPhysicalCameraId(physicalCameraId).build();
            return info.getCameraSelector();
        }
    }

    @PluginMethod public void startSession(PluginCall call) {
        Log.i("ClearWaterCamera","startSession invoked");
        if(Looper.myLooper()!=Looper.getMainLooper()){main.post(()->startSession(call));return;}
        PluginCall replacedStart=pendingSessionCall;
        if(pendingBindCall!=null&&pendingBindCall!=replacedStart){pendingBindCall.reject("Camera operation was replaced by a new session.","CANCELLED");pendingBindCall=null;}
        if(replacedStart!=null&&replacedStart!=call){pendingSessionCall=null;if(pendingBindCall==replacedStart)pendingBindCall=null;replacedStart.reject("Camera startup was replaced by a newer request.");}
        pendingSessionCall=call;
        long generation=++sessionGeneration;
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermissionResult"); return;
        }
        startSessionAfterPermission(call,generation);
    }

    @PluginMethod public void getLaunchMode(PluginCall call) {
        if(Looper.myLooper()!=Looper.getMainLooper()){main.post(()->getLaunchMode(call));return;}
        JSObject value = new JSObject(); value.put("mode", launchMode == null ? JSONObject.NULL : launchMode); call.resolve(value);
        launchMode = null;
    }

    @PermissionCallback private void cameraPermissionResult(PluginCall call) {
        if(Looper.myLooper()!=Looper.getMainLooper()){main.post(()->cameraPermissionResult(call));return;}
        if (call == null) return;
        if (call != pendingSessionCall) return;
        if (getPermissionState("camera") != PermissionState.GRANTED) { pendingSessionCall=null;call.reject("Camera permission was denied.", "PERMISSION_DENIED"); return; }
        startSessionAfterPermission(call,sessionGeneration);
    }

    private void startSessionAfterPermission(PluginCall call,long generation) {
        if(Looper.myLooper()!=Looper.getMainLooper()){main.post(()->startSessionAfterPermission(call,generation));return;}
        if(call!=pendingSessionCall||generation!=sessionGeneration)return;
        if (recordingActive) { pendingSessionCall=null;call.reject("Stop the recording before restarting the camera."); return; }
        Log.i("ClearWaterCamera","camera permission granted; preparing provider");
        if(mainExecutor==null)mainExecutor=ContextCompat.getMainExecutor(getContext());
        JSONObject bounds = call.getObject("bounds");
        facing = "user".equals(call.getString("facing", "environment")) ? "user" : "environment";
        quality = "high".equals(call.getString("quality", "standard")) ? "high" : "standard";
        recipe = call.getObject("recipe") == null ? new JSONObject() : call.getObject("recipe");
        String requestedLens = call.getString("lensId");
        try{lockCameraPortrait();ensurePreviewView(bounds);}catch(Exception error){pendingSessionCall=null;sessionActive=false;cleanupSessionResources();fail(call,"Could not place the camera preview.",error);return;}
        ListenableFuture<ProcessCameraProvider> future;
        try{future=ProcessCameraProvider.getInstance(getContext());}
        catch(Exception error){pendingSessionCall=null;sessionActive=false;cleanupSessionResources();fail(call,"Could not start the camera.",error);return;}
        future.addListener(() -> {
            Log.i("ClearWaterCamera","CameraX provider future completed");
            if(generation!=sessionGeneration||call!=pendingSessionCall)return;
            try {
                provider = future.get();
                enumerateLenses();
                selectedLensId = lenses.containsKey(requestedLens) ? requestedLens : defaultLensId(facing);
                resetZoomForLensSwitch = true;
                if (selectedLensId == null) throw new IllegalStateException("No camera matching this direction is available.");
                sessionActive = true;
                ensureOrientationListener();orientationListener.enable();
                bindIdle(call,generation);
            } catch (Exception error) { pendingSessionCall=null;sessionActive=false;cleanupSessionResources();fail(call, "Could not start the camera.", error); }
        }, mainExecutor);
    }

    @PluginMethod public void listLenses(PluginCall call) {
        if(Looper.myLooper()!=Looper.getMainLooper()){main.post(()->listLenses(call));return;}
        if(mainExecutor==null)mainExecutor=ContextCompat.getMainExecutor(getContext());
        if (provider != null) { call.resolve(new JSObject().put("lenses", lensArray())); return; }
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(getContext());
        future.addListener(() -> {
            try { provider=future.get(); enumerateLenses(); call.resolve(new JSObject().put("lenses", lensArray())); }
            catch (Exception error) { fail(call, "Could not inspect available cameras.", error); }
        }, mainExecutor);
    }

    private void enumerateLenses() {
        lenses.clear();
        CameraManager cameraManager=(CameraManager)getContext().getSystemService(Context.CAMERA_SERVICE);
        String defaultBackId=defaultCameraId(CameraSelector.DEFAULT_BACK_CAMERA);
        String defaultFrontId=defaultCameraId(CameraSelector.DEFAULT_FRONT_CAMERA);
        CameraCharacteristics defaultBackCharacteristics=cameraCharacteristics(cameraManager,defaultBackId);
        CameraCharacteristics defaultFrontCharacteristics=cameraCharacteristics(cameraManager,defaultFrontId);
        List<CameraInfo> available=provider.getAvailableCameraInfos();
        List<CameraInfo> ordered=new ArrayList<>();
        for(CameraInfo info:available)try {
            String id=Camera2CameraInfo.from(info).getCameraId();
            if(id.equals(defaultBackId)||id.equals(defaultFrontId))ordered.add(info);
        }catch(Exception ignored){}
        for(CameraInfo info:available)if(!ordered.contains(info))ordered.add(info);
        Set<String> physicalIds=new HashSet<>();
        for (CameraInfo info : ordered) {
            try {
                String id=Camera2CameraInfo.from(info).getCameraId();
                String lensFacing=info.getLensFacing()==CameraSelector.LENS_FACING_FRONT ? "user" : "environment";
                float reportedIntrinsic=info.getIntrinsicZoomRatio();
                String logicalId="logical:"+id;
                boolean primary=id.equals(defaultBackId)||id.equals(defaultFrontId);
                CameraCharacteristics logicalCharacteristics=cameraCharacteristics(cameraManager,id);
                float intrinsic=primary ? 1f : CameraLensGeometry.opticalRatio(reportedIntrinsic,
                    CameraLensGeometry.relativeZoom("user".equals(lensFacing)?defaultFrontCharacteristics:defaultBackCharacteristics,
                        logicalCharacteristics));
                // A standalone CameraX camera is directly selectable. Prefer it
                // to an equivalent physical selector advertised by a logical camera.
                if(primary || !hasEquivalentLens(lensFacing,intrinsic,false)) {
                    removeEquivalentPhysicalLenses(lensFacing,intrinsic);
                    float[] zoomBounds=logicalZoomBounds(logicalCharacteristics);
                    lenses.put(logicalId,new Lens(logicalId,labelFor(intrinsic, !primary),lensFacing,null,id,info,intrinsic,zoomBounds[0],zoomBounds[1]));
                }
                Set<String> advertisedIds=Build.VERSION.SDK_INT>=Build.VERSION_CODES.P && logicalCharacteristics!=null
                    ? logicalCharacteristics.getPhysicalCameraIds() : Collections.emptySet();
                if (info.isLogicalMultiCameraSupported() || !advertisedIds.isEmpty()) {
                    // CameraX can omit hidden physical modules from its CameraInfo
                    // set even when Camera2 advertises them on the logical camera.
                    // The Camera2 IDs are valid targets for setPhysicalCameraId.
                    Map<String,Float> cameraXPhysicalRatios=new HashMap<>();
                    try { for(CameraInfo physical:info.getPhysicalCameraInfos())try {
                        String physicalId=Camera2CameraInfo.from(physical).getCameraId();
                        if(physicalId!=null&&!physicalId.isEmpty())
                            cameraXPhysicalRatios.put(physicalId,physical.getIntrinsicZoomRatio());
                    }catch(Exception ignored){} }catch(Exception ignored){}
                    Set<String> candidates=new TreeSet<>();
                    candidates.addAll(advertisedIds);
                    candidates.addAll(cameraXPhysicalRatios.keySet());
                    for (String physicalId : candidates) {
                        try {
                            if (physicalId==null || physicalId.isEmpty() || physicalIds.contains(physicalId) ||
                                (Build.VERSION.SDK_INT>=Build.VERSION_CODES.P && logicalCharacteristics!=null &&
                                    !advertisedIds.contains(physicalId))) continue;
                            float reportedRatio=cameraXPhysicalRatios.getOrDefault(physicalId,Float.NaN);
                            // CameraX returns 1 when optical metadata is missing;
                            // do not call an unknown module a 1x wide lens.
                            float ratio=CameraLensGeometry.opticalRatio(reportedRatio,Float.NaN);
                            CameraCharacteristics physicalCharacteristics=null;
                            try {
                                if(cameraManager!=null && logicalCharacteristics!=null) {
                                    physicalCharacteristics=cameraManager.getCameraCharacteristics(physicalId);
                                    float measured=CameraLensGeometry.relativeZoom(logicalCharacteristics,
                                        physicalCharacteristics);
                                    if(validIntrinsicZoom(measured)&&validIntrinsicZoom(intrinsic))ratio=measured*intrinsic;
                                }
                            } catch(Exception ignored) { /* Use CameraX metadata if a physical ID is hidden. */ }
                            physicalIds.add(physicalId);
                            if(hasEquivalentLens(lensFacing,ratio,null))continue;
                            String key="physical:"+id+":"+physicalId;
                            float[] zoomBounds=physicalZoomBounds(physicalCharacteristics);
                            lenses.put(key,new Lens(key,labelFor(ratio, true),lensFacing,physicalId,id,info,ratio,zoomBounds[0],zoomBounds[1]));
                        } catch(Exception ignored) { /* Keep other physical cameras selectable. */ }
                    }
                }
            } catch (Exception ignored) { /* Keep other cameras available when one OEM camera reports incomplete metadata. */ }
        }
    }

    private String defaultCameraId(CameraSelector selector) {
        try { return Camera2CameraInfo.from(provider.getCameraInfo(selector)).getCameraId(); }
        catch(Exception ignored) { return null; }
    }

    private CameraCharacteristics cameraCharacteristics(CameraManager manager,String id) {
        if(manager==null||id==null)return null;
        try{return manager.getCameraCharacteristics(id);}catch(Exception ignored){return null;}
    }

    private float[] physicalZoomBounds(CameraCharacteristics characteristics) {
        if(characteristics==null)return new float[]{1f,Float.POSITIVE_INFINITY};
        try {
            if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.R){
                Range<Float> range=characteristics.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE);
                if(range!=null&&Float.isFinite(range.getLower())&&Float.isFinite(range.getUpper())&&range.getUpper()>=1f){
                    float min=Math.max(1f,range.getLower());
                    if(range.getUpper()>=min)return new float[]{min,range.getUpper()};
                }
            }
            Float max=characteristics.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM);
            return new float[]{1f,max!=null&&Float.isFinite(max)&&max>=1f?max:Float.POSITIVE_INFINITY};
        } catch(Exception ignored) { return new float[]{1f,Float.POSITIVE_INFINITY}; }
    }

    private float[] logicalZoomBounds(CameraCharacteristics characteristics) {
        if(characteristics==null)return new float[]{Float.NaN,Float.NaN};
        try {
            if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.R){
                Range<Float> range=characteristics.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE);
                if(range!=null&&Float.isFinite(range.getLower())&&Float.isFinite(range.getUpper())&&
                    range.getLower()>0f&&range.getUpper()>=range.getLower())
                    return new float[]{range.getLower(),range.getUpper()};
            }
            Float max=characteristics.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM);
            return max!=null&&Float.isFinite(max)&&max>=1f
                ? new float[]{1f,max} : new float[]{Float.NaN,Float.NaN};
        } catch(Exception ignored) { return new float[]{Float.NaN,Float.NaN}; }
    }

    private boolean hasEquivalentLens(String facing,float ratio,Boolean physicalOnly) {
        if(!validIntrinsicZoom(ratio))return false;
        for(Lens lens:lenses.values())if(facing.equals(lens.facing) &&
            (physicalOnly==null||lens.physical()==physicalOnly) && validIntrinsicZoom(lens.intrinsicZoom) &&
            Math.abs(lens.intrinsicZoom-ratio)/Math.max(lens.intrinsicZoom,ratio)<.08f)return true;
        return false;
    }

    private void removeEquivalentPhysicalLenses(String facing,float ratio) {
        if(!validIntrinsicZoom(ratio))return;
        List<String> duplicates=new ArrayList<>();
        for(Lens lens:lenses.values())if(lens.physical() && facing.equals(lens.facing) &&
            validIntrinsicZoom(lens.intrinsicZoom) &&
            Math.abs(lens.intrinsicZoom-ratio)/Math.max(lens.intrinsicZoom,ratio)<.08f)duplicates.add(lens.id);
        for(String id:duplicates)lenses.remove(id);
    }

    private String defaultLensId(String requestedFacing) {
        String desired="user".equals(requestedFacing)?"user":"environment";
        String preferred=defaultCameraId("user".equals(desired)?CameraSelector.DEFAULT_FRONT_CAMERA:CameraSelector.DEFAULT_BACK_CAMERA);
        if(preferred!=null && lenses.containsKey("logical:"+preferred))return "logical:"+preferred;
        Lens best=null;
        for (Lens item:lenses.values()) if (desired.equals(item.facing) && !item.physical()) {
            if (best==null || Math.abs(item.intrinsicZoom-1f)<Math.abs(best.intrinsicZoom-1f)) best=item;
        }
        return best==null?null:best.id;
    }

    private String labelFor(float ratio, boolean physical) {
        if(!validIntrinsicZoom(ratio))return physical?"Lens":"Camera";
        if (ratio < .8f) return "Ultra-wide";
        if (ratio > 1.35f) return "Telephoto";
        return physical ? "Wide" : "Camera";
    }

    private static boolean validIntrinsicZoom(float ratio){return Float.isFinite(ratio)&&ratio>0f;}

    private JSArray lensArray() {
        JSArray values=new JSArray();
        for (Lens lens:lenses.values()) {
            JSObject value=new JSObject(); value.put("id",lens.id); value.put("label",lens.label); value.put("facing",lens.facing);
            if(validIntrinsicZoom(lens.intrinsicZoom))value.put("intrinsicZoom",lens.intrinsicZoom);
            float min=lens.metadataMinZoom,max=lens.metadataMaxZoom;
            androidx.camera.core.ZoomState state=null;
            try { state=lens.info.getZoomState().getValue(); } catch(Exception ignored) {}
            if(state!=null){
                if(!Float.isFinite(min))min=state.getMinZoomRatio();
                else min=Math.max(min,state.getMinZoomRatio());
                if(!Float.isFinite(max))max=state.getMaxZoomRatio();
                else max=Math.min(max,state.getMaxZoomRatio());
            }
            if(validIntrinsicZoom(min)&&Float.isFinite(max)&&max>=min){
                value.put("minZoom",min);value.put("maxZoom",max);
            }
            values.put(value);
        }
        return values;
    }

    @PluginMethod public void setPreviewBounds(PluginCall call) {
        if(Looper.myLooper()!=Looper.getMainLooper()){main.post(()->setPreviewBounds(call));return;}
        JSONObject bounds=call.getData();
        if (previewView==null) { call.reject("The camera preview is not active."); return; }
        updatePreviewBounds(bounds); call.resolve();
    }

    @PluginMethod public void setCorrection(PluginCall call) {
        if(Looper.myLooper()!=Looper.getMainLooper()){main.post(()->setCorrection(call));return;}
        if (!sessionActive) { call.reject("The camera is not active."); return; }
        if (recordingActive) { call.resolve(); return; }
        JSONObject next=call.getObject("recipe"); if(next==null){call.reject("Missing camera correction recipe.");return;}
        recipe=next;
        if(media3Effect!=null)try{media3Effect.setEffects(Collections.singletonList(new CameraRecipeEffect(recipe)));}catch(Exception error){fail(call,"Could not update live camera correction.",error);return;}
        call.resolve();
    }

    @PluginMethod public void setLens(PluginCall call) {
        if(Looper.myLooper()!=Looper.getMainLooper()){main.post(()->setLens(call));return;}
        String id=call.getString("lensId");
        if (!sessionActive || id==null || !lenses.containsKey(id)) { call.reject("That camera lens is unavailable."); return; }
        if (recordingActive) { call.reject("Stop recording before changing camera lenses."); return; }
        resetZoomForLensSwitch=!id.equals(selectedLensId);
        selectedLensId=id; facing=lenses.get(id).facing;
        bindIdle(call);
    }

    @PluginMethod public void setZoom(PluginCall call) {
        if(Looper.myLooper()!=Looper.getMainLooper()){main.post(()->setZoom(call));return;}
        if(camera==null || recordingActive){call.reject("The camera is not ready for zoom changes.");return;}
        float ratio=call.getDouble("ratio",1d).floatValue();if(!Float.isFinite(ratio)){call.reject("Invalid zoom ratio.");return;}
        ratio=CameraLensGeometry.clampZoom(ratio,effectiveZoomBounds());
        final Camera zoomCamera=camera;final long generation=sessionGeneration;
        com.google.common.util.concurrent.ListenableFuture<Void> change=zoomCamera.getCameraControl().setZoomRatio(ratio);
        change.addListener(()->{
            try { change.get();if(generation!=sessionGeneration||camera!=zoomCamera){call.reject("Zoom request was cancelled.","CANCELLED");return;}JSObject result=new JSObject(); result.put("zoom",zoomRatio());call.resolve(result); }
            catch(Exception error){fail(call,"Could not change camera zoom.",error);}
        },mainExecutor);
    }

    @PluginMethod public void sampleFrame(PluginCall call) {
        if(Looper.myLooper()!=Looper.getMainLooper()){main.post(()->sampleFrame(call));return;}
        if (!sessionActive || imageAnalysis==null) { call.reject("Camera frame sampling is unavailable while recording."); return; }
        synchronized(this){
            if(latestSampleData==null){call.reject("The camera is still preparing a frame.");return;}
            JSObject result=new JSObject();result.put("data",latestSampleData);result.put("width",latestSampleWidth);result.put("height",latestSampleHeight);call.resolve(result);
        }
    }

    @PluginMethod public void capturePhoto(PluginCall call) {
        if(Looper.myLooper()!=Looper.getMainLooper()){main.post(()->capturePhoto(call));return;}
        if(!sessionActive||imageCapture==null||recordingActive){call.reject("The camera is not ready for a photo.");return;}
        File directory=new File(getContext().getCacheDir(),"camera-captures");
        if(!directory.isDirectory()&&!directory.mkdirs()){call.reject("Temporary camera storage is unavailable.");return;}
        String name="clearwater-camera-"+UUID.randomUUID()+".jpg";File output=new File(directory,name);
        ImageCapture activeCapture=imageCapture;
        String captureLensId=selectedLensId;
        long captureGeneration=sessionGeneration;
        ImageCapture.OutputFileOptions options=new ImageCapture.OutputFileOptions.Builder(output).build();
        try{activeCapture.setTargetRotation(captureRotation);}catch(Exception ignored){}

        activeCapture.takePicture(options,mainExecutor,new ImageCapture.OnImageSavedCallback(){
            @Override public void onImageSaved(@NonNull ImageCapture.OutputFileResults result){
                if(captureGeneration!=sessionGeneration){if(output.exists())output.delete();call.reject("Photo capture was cancelled.","CANCELLED");return;}
                if(!output.isFile()||output.length()<=0){if(output.exists())output.delete();call.reject("The camera returned an empty photo.");return;}
                BitmapFactory.Options jpegBounds=new BitmapFactory.Options();jpegBounds.inJustDecodeBounds=true;BitmapFactory.decodeFile(output.getAbsolutePath(),jpegBounds);
                int photoWidth=jpegBounds.outWidth,photoHeight=jpegBounds.outHeight;
                try{
                    ExifInterface exif=new ExifInterface(output.getAbsolutePath());
                    int orientation=exif.getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL);
                    if(orientation==ExifInterface.ORIENTATION_ROTATE_90||orientation==ExifInterface.ORIENTATION_ROTATE_270||orientation==ExifInterface.ORIENTATION_TRANSPOSE||orientation==ExifInterface.ORIENTATION_TRANSVERSE){int swap=photoWidth;photoWidth=photoHeight;photoHeight=swap;}
                }catch(Exception error){Log.w("ClearWaterCamera","Could not read photo orientation metadata.",error);}
                Log.i("ClearWaterCamera","photo saved JPEG="+jpegBounds.outWidth+"x"+jpegBounds.outHeight+" oriented="+photoWidth+"x"+photoHeight+" bytes="+output.length()+" lens="+captureLensId+" rotation="+captureRotation);
                synchronized(temporaryCaptures){temporaryCaptures.put(Uri.fromFile(output).toString(),output);}
                JSObject value=new JSObject();value.put("uri",Uri.fromFile(output).toString());value.put("name",name);value.put("type","image/jpeg");value.put("width",photoWidth);value.put("height",photoHeight);value.put("lensId",captureLensId);call.resolve(value);
            }
            @Override public void onError(@NonNull ImageCaptureException error){if(output.exists())output.delete();fail(call,"Could not capture the photo.",error);}
        });
    }

    @PluginMethod public void releaseCapture(PluginCall call) {
        if(Looper.myLooper()!=Looper.getMainLooper()){main.post(()->releaseCapture(call));return;}
        String uri=call.getString("uri");File file;
        synchronized(temporaryCaptures){file=temporaryCaptures.remove(uri);}
        if(file==null){call.reject("That temporary camera capture is not owned by the app.");return;}
        if(file.exists()&&!file.delete()){synchronized(temporaryCaptures){temporaryCaptures.put(uri,file);}call.reject("Could not release the temporary camera capture.");return;}
        call.resolve();
    }

    @PluginMethod public void startRecording(PluginCall call) {
        if(Looper.myLooper()!=Looper.getMainLooper()){main.post(()->startRecording(call));return;}
        if(!sessionActive||recordingActive){call.reject("The camera is not ready to record.");return;}
        if(pendingRecordingPermissionCall!=null){pendingRecordingPermissionCall.reject("A newer video request replaced this one.");pendingRecordingPermissionCall=null;}
        JSONObject recordingRecipe=call.getObject("recipe");if(recordingRecipe!=null)recipe=recordingRecipe;
        if(media3Effect!=null)try{media3Effect.setEffects(Collections.singletonList(new CameraRecipeEffect(recipe)));}catch(Exception error){fail(call,"Could not prepare camera correction for recording.",error);return;}
        microphoneRequested=call.getBoolean("microphone",false);
        if(microphoneRequested&&getPermissionState("microphone")!=PermissionState.GRANTED){pendingRecordingPermissionCall=call;requestPermissionForAlias("microphone",call,"recordingPermissionResult");return;}
        beginRecording(call);
    }

    @PermissionCallback private void recordingPermissionResult(PluginCall call){
        if(Looper.myLooper()!=Looper.getMainLooper()){main.post(()->recordingPermissionResult(call));return;}
        if(call==null)return;
        if(call!=pendingRecordingPermissionCall)return;
        pendingRecordingPermissionCall=null;
        microphoneRequested=call.getBoolean("microphone",false)&&getPermissionState("microphone")==PermissionState.GRANTED;
        if(call.getBoolean("microphone",false)&&!microphoneRequested){call.reject("Microphone permission was denied.","PERMISSION_DENIED");return;}
        beginRecording(call);
    }

    private void beginRecording(PluginCall call) {
        File outputFile=null;
        try {
            final int recordingRotation=captureRotation;
            rebindForVideo();
            if(videoCapture!=null)videoCapture.setTargetRotation(recordingRotation);
            File directory=new File(getContext().getCacheDir(),"camera-captures");if(!directory.isDirectory()&&!directory.mkdirs())throw new IllegalStateException("Temporary camera storage is unavailable.");
            recordingFile=new File(directory,"clearwater-camera-"+UUID.randomUUID()+".mp4");outputFile=recordingFile;recordingDiscard=false;
            long maxMs=call.getLong("maxMs",180000L);long maxBytes=call.getLong("maxBytes",192L*1024*1024);
            long boundedMaxBytes=maxBytes>0?Math.max(1024*1024,Math.min(maxBytes,512L*1024*1024)):Long.MAX_VALUE;
            FileOutputOptions output=new FileOutputOptions.Builder(recordingFile).setFileSizeLimit(boundedMaxBytes).build();
            PendingRecording pending=videoCapture.getOutput().prepareRecording(getContext(),output);
            if(microphoneRequested&&ContextCompat.checkSelfPermission(getContext(),Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)pending=pending.withAudioEnabled(true);
            recordingMaxAt=maxMs>0?SystemClock.elapsedRealtime()+Math.max(1000,Math.min(maxMs,600000)):0;
            recordingMaxBytes=boundedMaxBytes;
            recordingActive=true;
            recording=pending.start(mainExecutor,event->{
                if(event instanceof VideoRecordEvent.Finalize)finishRecording((VideoRecordEvent.Finalize)event);
            });
            main.postDelayed(recordingLimitCheck,500);
            call.resolve();
        } catch(Exception error){recordingActive=false;recording=null;recordingFile=null;if(outputFile!=null&&outputFile.exists())outputFile.delete();fail(call,"Could not start video recording.",error);try{if(sessionActive)bindIdle(null);else cleanupSessionResources();}catch(Exception ignored){}}
    }

    @PluginMethod public void stopRecording(PluginCall call) {
        if(Looper.myLooper()!=Looper.getMainLooper()){main.post(()->stopRecording(call));return;}
        if(recording==null){call.resolve();return;}
        recordingDiscard=recordingDiscard||call.getBoolean("discard",false);recording.stop();call.resolve();
    }

    private void finishRecording(VideoRecordEvent.Finalize event) {
        main.removeCallbacks(recordingLimitCheck);
        boolean reachedFileLimit=event.getError()==VideoRecordEvent.Finalize.ERROR_FILE_SIZE_LIMIT_REACHED;
        File file=recordingFile;boolean discard=recordingDiscard||(event.hasError()&&!reachedFileLimit);
        recording=null;recordingFile=null;recordingActive=false;
        if(discard){if(file!=null&&file.exists())file.delete();}
        JSObject result=new JSObject();result.put("discarded",discard);result.put("width",videoWidth());result.put("height",videoHeight());
        if(!discard&&file!=null&&file.isFile()&&file.length()>0){String uri=Uri.fromFile(file).toString();synchronized(temporaryCaptures){temporaryCaptures.put(uri,file);}result.put("uri",uri);result.put("name",file.getName());result.put("type","video/mp4");}
        else if(event.hasError()&&!reachedFileLimit)result.put("error","Video recording failed (CameraX error "+event.getError()+").");
        notifyListeners("recordingFinished",result);
        if(sessionActive)try{bindIdle(null);}catch(Exception error){notifyCameraError("Could not restore the camera preview.",error);}
        else cleanupSessionResources();
    }

    @PluginMethod public void stopSession(PluginCall call) {
        if(Looper.myLooper()!=Looper.getMainLooper()){main.post(()->stopSession(call));return;}
        sessionGeneration++;
        bindGeneration++;
        PluginCall startup=pendingSessionCall;pendingSessionCall=null;
        if(startup!=null)startup.reject("Camera startup was cancelled.","CANCELLED");
        PluginCall binding=pendingBindCall;pendingBindCall=null;
        if(binding!=null&&binding!=startup)binding.reject("Camera operation was cancelled.","CANCELLED");
        if(pendingRecordingPermissionCall!=null){pendingRecordingPermissionCall.reject("Video recording was cancelled.","CANCELLED");pendingRecordingPermissionCall=null;}
        boolean finishingRecording=recording!=null;
        if(finishingRecording)recording.stop();
        sessionActive=false;if(orientationListener!=null)orientationListener.disable();
        if(!finishingRecording)cleanupSessionResources();
        call.resolve();
    }

    private void bindIdle(PluginCall call) { bindIdle(call,sessionGeneration); }

    private void bindIdle(PluginCall call,long generation) {
        if(pendingBindCall!=null&&pendingBindCall!=call){pendingBindCall.reject("Camera operation was replaced by a newer request.","CANCELLED");pendingBindCall=null;}
        if(call!=null)pendingBindCall=call;
        long bindId=++bindGeneration;
        Runnable task=()->{
            Log.i("ClearWaterCamera","binding idle camera use cases");
            if(bindId!=bindGeneration)return;
            if(call!=null&&call!=pendingBindCall)return;
            if(!sessionActive||generation!=sessionGeneration){if(call!=null&&call==pendingBindCall){pendingBindCall=null;call.reject("Camera startup was cancelled.","CANCELLED");}return;}
            try {
                float zoomToRestore=resetZoomForLensSwitch?1f:camera==null?1f:zoomRatio();
                resetZoomForLensSwitch=false;
                synchronized(this){latestSampleData=null;}long frameGeneration=++analysisGeneration;
                if(provider!=null)provider.unbindAll();closeEffect();
                Lens selectedLens=lenses.get(selectedLensId);
                String physicalId=selectedLens==null?null:selectedLens.physicalCameraId;
                Preview.Builder previewBuilder=new Preview.Builder().setTargetRotation(displayRotation());
                ImageCapture.Builder imageCaptureBuilder=new ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY).setJpegQuality(98).setTargetRotation(captureRotation);
                ImageAnalysis.Builder analysisBuilder=new ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).setTargetResolution(new Size(640,480)).setTargetRotation(displayRotation());
                if(physicalId!=null){
                    constrainPhysicalJpegResolution(imageCaptureBuilder,selectedLens);
                    // Normal CameraX binding does not copy the selector's physical ID to outputs.
                    // All use cases must target the same physical camera for one session.
                    new Camera2Interop.Extender<>(previewBuilder).setPhysicalCameraId(physicalId);
                    new Camera2Interop.Extender<>(imageCaptureBuilder).setPhysicalCameraId(physicalId);
                    new Camera2Interop.Extender<>(analysisBuilder).setPhysicalCameraId(physicalId);
                }
                new Camera2Interop.Extender<>(previewBuilder).setSessionCaptureCallback(lensCaptureCallback(selectedLensId,physicalId));
                preview=previewBuilder.build();
                imageCapture=imageCaptureBuilder.build();
                imageAnalysis=analysisBuilder.build();
                imageAnalysis.setAnalyzer(analysisExecutor,image->analyzeFrame(image,frameGeneration));
                long effectGeneration=++media3EffectGeneration;
                media3Effect=new Media3Effect(getContext(),CameraEffect.PREVIEW|CameraEffect.VIDEO_CAPTURE,mainExecutor,error->{if(effectGeneration==media3EffectGeneration&&sessionActive)notifyCameraError("Live camera correction stopped.",error);});
                media3Effect.setEffects(Collections.singletonList(new CameraRecipeEffect(recipe)));
                preview.setSurfaceProvider(previewView.getSurfaceProvider());
                previewView.post(()->{
                    if(bindId!=bindGeneration)return;
                    if(call!=null&&call!=pendingBindCall)return;
                    if(!sessionActive||generation!=sessionGeneration){if(call!=null&&call==pendingBindCall){pendingBindCall=null;call.reject("Camera operation was cancelled.","CANCELLED");}return;}
                    try{
                        UseCaseGroup group=new UseCaseGroup.Builder().addUseCase(preview).addUseCase(imageCapture).addUseCase(imageAnalysis).addEffect(media3Effect).build();
                        camera=provider.bindToLifecycle((LifecycleOwner)getActivity(),lensSelector(),group);
                        Log.i("ClearWaterCamera","camera use cases bound");
                        lastBoundLensId=selectedLensId;
                        notifyPhotoInfoChanged();
                        restoreZoom(zoomToRestore);
                        if(call!=null&&call==pendingBindCall){pendingBindCall=null;if(call==pendingSessionCall)pendingSessionCall=null;call.resolve(sessionInfo());}
                    }catch(Exception error){
                        closeEffect();
                        // Some OEMs advertise a physical module but reject the
                        // requested output combination. Remove that choice and
                        // restore the previous live camera for the caller.
                        if(call!=null&&call!=pendingSessionCall&&call==pendingBindCall&&
                            lastBoundLensId!=null&&!lastBoundLensId.equals(selectedLensId)&&
                            lenses.containsKey(lastBoundLensId)) {
                            String unavailable=selectedLensId;
                            lenses.remove(unavailable);
                            selectedLensId=lastBoundLensId;
                            facing=lenses.get(selectedLensId).facing;
                            Log.w("ClearWaterCamera","Physical camera binding failed; restoring previous camera",error);
                            bindIdle(call,generation);
                            return;
                        }
                        sessionActive=false;cleanupSessionResources();
                        if(call!=null&&call==pendingBindCall){pendingBindCall=null;if(call==pendingSessionCall)pendingSessionCall=null;fail(call,"Could not open the selected camera lens.",error);}
                        else notifyCameraError("Could not open the selected camera lens.",error);
                    }
                });
            }catch(Exception error){sessionActive=false;cleanupSessionResources();if(call!=null&&call==pendingBindCall){pendingBindCall=null;if(call==pendingSessionCall)pendingSessionCall=null;fail(call,"Could not configure the camera.",error);}else notifyCameraError("Could not configure the camera.",error);}
        };
        if(Looper.myLooper()==Looper.getMainLooper())task.run();else main.post(task);
    }

    private void rebindForVideo() {
        float zoomToRestore=camera==null?1f:zoomRatio();
        synchronized(this){latestSampleData=null;}analysisGeneration++;
        if(provider!=null)provider.unbindAll();
        if(imageAnalysis!=null){imageAnalysis.clearAnalyzer();imageAnalysis=null;}
        closeEffect();
        Lens selectedLens=lenses.get(selectedLensId);
        String physicalId=selectedLens==null?null:selectedLens.physicalCameraId;
        Preview.Builder previewBuilder=new Preview.Builder().setTargetRotation(displayRotation());
        if(physicalId!=null)new Camera2Interop.Extender<>(previewBuilder).setPhysicalCameraId(physicalId);
        new Camera2Interop.Extender<>(previewBuilder).setSessionCaptureCallback(lensCaptureCallback(selectedLensId,physicalId));
        preview=previewBuilder.build();
        Recorder.Builder recorderBuilder=new Recorder.Builder();
        if("high".equals(quality))recorderBuilder.setQualitySelector(QualitySelector.from(Quality.FHD,FallbackStrategy.lowerQualityOrHigherThan(Quality.HD)));
        else recorderBuilder.setQualitySelector(QualitySelector.from(Quality.HD,FallbackStrategy.lowerQualityOrHigherThan(Quality.SD)));
        Recorder recorder=recorderBuilder.build();
        VideoCapture.Builder<Recorder> videoBuilder=new VideoCapture.Builder<>(recorder).setTargetRotation(displayRotation());
        if(physicalId!=null)new Camera2Interop.Extender<>(videoBuilder).setPhysicalCameraId(physicalId);
        videoCapture=videoBuilder.build();
        long effectGeneration=++media3EffectGeneration;
        media3Effect=new Media3Effect(getContext(),CameraEffect.PREVIEW|CameraEffect.VIDEO_CAPTURE,mainExecutor,error->{if(effectGeneration==media3EffectGeneration&&sessionActive)notifyCameraError("Live camera correction stopped.",error);});
        media3Effect.setEffects(Collections.singletonList(new CameraRecipeEffect(recipe)));
        preview.setSurfaceProvider(previewView.getSurfaceProvider());
        UseCaseGroup group=new UseCaseGroup.Builder().addUseCase(preview).addUseCase(videoCapture).addEffect(media3Effect).build();
        camera=provider.bindToLifecycle((LifecycleOwner)getActivity(),lensSelector(),group);
        restoreZoom(zoomToRestore);
    }

    private CameraSelector lensSelector() {
        Lens lens=lenses.get(selectedLensId);if(lens==null)throw new IllegalStateException("Selected camera lens is no longer available.");return lens.selector();
    }

    private void constrainPhysicalJpegResolution(ImageCapture.Builder builder,Lens lens) {
        if(lens==null||!lens.physical())return;
        CameraManager manager=(CameraManager)getContext().getSystemService(Context.CAMERA_SERVICE);
        CameraCharacteristics physical=cameraCharacteristics(manager,lens.physicalCameraId);
        CameraCharacteristics logical=cameraCharacteristics(manager,lens.logicalCameraId);
        if(physical==null||logical==null)return;
        try {
            StreamConfigurationMap physicalMap=physical.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
            StreamConfigurationMap logicalMap=logical.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
            if(physicalMap==null||logicalMap==null)return;
            Size[] physicalSizes=physicalMap.getOutputSizes(ImageFormat.JPEG);
            Size[] logicalSizes=logicalMap.getOutputSizes(ImageFormat.JPEG);
            if(physicalSizes==null||logicalSizes==null)return;
            Set<Size> logicalJpegs=new HashSet<>();
            Collections.addAll(logicalJpegs,logicalSizes);
            Set<Size> allowed=new HashSet<>();
            Size preferred=null;
            for(Size size:physicalSizes){
                long pixels=(long)size.getWidth()*size.getHeight();
                if(pixels<=0||pixels>MAX_PHYSICAL_JPEG_PIXELS||!logicalJpegs.contains(size))continue;
                allowed.add(size);
                if(preferred==null||pixels>(long)preferred.getWidth()*preferred.getHeight()||
                    (pixels==(long)preferred.getWidth()*preferred.getHeight()&&size.getWidth()>preferred.getWidth()))preferred=size;
            }
            if(preferred==null)return;
            builder.setResolutionSelector(new ResolutionSelector.Builder()
                .setResolutionStrategy(new ResolutionStrategy(preferred,ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
                .setResolutionFilter((supported,rotation)->{
                    List<Size> matching=new ArrayList<>();
                    for(Size size:supported)if(allowed.contains(size))matching.add(size);
                    return matching.isEmpty()?supported:matching;
                }).build());
            Log.i("ClearWaterCamera","physical JPEG preferred="+preferred+" candidates="+allowed.size());
        }catch(Exception error){Log.w("ClearWaterCamera","Could not inspect physical JPEG sizes; using CameraX defaults",error);}
    }

    private CameraCaptureSession.CaptureCallback lensCaptureCallback(String lensId,String requestedPhysicalId) {
        AtomicInteger frames=new AtomicInteger();
        return new CameraCaptureSession.CaptureCallback() {
            @Override public void onCaptureCompleted(@NonNull CameraCaptureSession session,@NonNull CaptureRequest request,@NonNull TotalCaptureResult result) {
                int frame=frames.incrementAndGet();
                if(frame!=1&&frame!=30&&frame!=120)return;
                String active=Build.VERSION.SDK_INT>=Build.VERSION_CODES.P
                    ? result.get(CaptureResult.LOGICAL_MULTI_CAMERA_ACTIVE_PHYSICAL_ID) : null;
                Float focal=result.get(CaptureResult.LENS_FOCAL_LENGTH);
                Float zoom=Build.VERSION.SDK_INT>=Build.VERSION_CODES.R
                    ? result.get(CaptureResult.CONTROL_ZOOM_RATIO) : null;
                CaptureResult physicalResult=Build.VERSION.SDK_INT>=Build.VERSION_CODES.P&&requestedPhysicalId!=null
                    ? result.getPhysicalCameraResults().get(requestedPhysicalId) : null;
                Float physicalFocal=physicalResult==null?null:physicalResult.get(CaptureResult.LENS_FOCAL_LENGTH);
                Float physicalZoom=Build.VERSION.SDK_INT>=Build.VERSION_CODES.R&&physicalResult!=null
                    ? physicalResult.get(CaptureResult.CONTROL_ZOOM_RATIO) : null;
                Log.i("ClearWaterCamera","capture frame="+frame+" lens="+lensId+
                    " requestedPhysical="+requestedPhysicalId+" activePhysical="+active+
                    " focalMm="+focal+" zoom="+zoom+" physicalResults="+
                    (Build.VERSION.SDK_INT>=Build.VERSION_CODES.P?result.getPhysicalCameraResults().keySet():Collections.emptySet())+
                    " requestedPhysicalFocalMm="+physicalFocal+" requestedPhysicalZoom="+physicalZoom);
            }
        };
    }

    private void analyzeFrame(ImageProxy image,long frameGeneration) {
        try {
            long now=SystemClock.elapsedRealtime();if(now-lastSampleAt<400)return;lastSampleAt=now;
            byte[] jpeg=toJpeg(image);if(jpeg==null)return;
            Bitmap decoded=BitmapFactory.decodeByteArray(jpeg,0,jpeg.length);if(decoded==null)return;
            int rotation=image.getImageInfo().getRotationDegrees();
            if(rotation%360!=0){Matrix matrix=new Matrix();matrix.postRotate(rotation);Bitmap rotated=Bitmap.createBitmap(decoded,0,0,decoded.getWidth(),decoded.getHeight(),matrix,true);if(decoded!=rotated)decoded.recycle();decoded=rotated;}
            if("user".equals(facing)){Matrix mirror=new Matrix();mirror.setScale(-1f,1f);Bitmap mirrored=Bitmap.createBitmap(decoded,0,0,decoded.getWidth(),decoded.getHeight(),mirror,true);if(decoded!=mirrored)decoded.recycle();decoded=mirrored;}
            float scale=Math.min(1f,256f/Math.max(decoded.getWidth(),decoded.getHeight()));
            Bitmap small=scale<1?Bitmap.createScaledBitmap(decoded,Math.max(1,Math.round(decoded.getWidth()*scale)),Math.max(1,Math.round(decoded.getHeight()*scale)),true):decoded;
            ByteArrayOutputStream output=new ByteArrayOutputStream();small.compress(Bitmap.CompressFormat.JPEG,78,output);
            String base64=Base64.encodeToString(output.toByteArray(),Base64.NO_WRAP);
            synchronized(this){if(frameGeneration==analysisGeneration){latestSampleData=base64;latestSampleWidth=small.getWidth();latestSampleHeight=small.getHeight();}}
            if(small!=decoded)small.recycle();decoded.recycle();
        }catch(Exception ignored){}finally{image.close();}
    }

    private byte[] toJpeg(ImageProxy image) {
        if(image.getFormat()!=ImageFormat.YUV_420_888||image.getPlanes().length<3)return null;
        Rect crop=image.getCropRect();int left=(crop.left+1)&~1,top=(crop.top+1)&~1;int right=crop.right&~1,bottom=crop.bottom&~1;int width=right-left,height=bottom-top;
        if(width<=0||height<=0)return null;
        byte[] nv21=new byte[width*height*3/2];
        ImageProxy.PlaneProxy[] planes=image.getPlanes();
        copyPlane(planes[0],left,top,width,height,nv21,0,1);
        int chromaOffset=width*height;
        for(int y=0;y<height/2;y++)for(int x=0;x<width/2;x++){
            int sourceX=(left/2)+x,sourceY=(top/2)+y;
            nv21[chromaOffset+y*width+x*2]=sample(planes[2],sourceX,sourceY);
            nv21[chromaOffset+y*width+x*2+1]=sample(planes[1],sourceX,sourceY);
        }
        ByteArrayOutputStream output=new ByteArrayOutputStream();
        new YuvImage(nv21,ImageFormat.NV21,width,height,null).compressToJpeg(new Rect(0,0,width,height),85,output);
        return output.toByteArray();
    }

    private void copyPlane(ImageProxy.PlaneProxy plane,int left,int top,int width,int height,byte[] out,int offset,int stride) {
        for(int y=0;y<height;y++)for(int x=0;x<width;x++)out[offset+(y*width+x)*stride]=sample(plane,left+x,top+y);
    }
    private byte sample(ImageProxy.PlaneProxy plane,int x,int y) {
        ByteBuffer buffer=plane.getBuffer();int index=y*plane.getRowStride()+x*plane.getPixelStride();return buffer.get(index);
    }

    private void ensurePreviewView(JSONObject bounds) {
        WebView webView=getBridge().getWebView();
        if(previewView==null){
            if(webView==null||!(webView.getParent() instanceof ViewGroup))throw new IllegalStateException("Could not place the native camera preview.");
            int windowFlags=getActivity().getWindow().getAttributes().flags;
            keepScreenOnWasAlreadySet=(windowFlags&WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)!=0;
            if(!keepScreenOnWasAlreadySet){getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);changedKeepScreenOn=true;}
            savedWebViewBackground=webView.getBackground();hasSavedWebViewBackground=true;webView.setBackgroundColor(android.graphics.Color.TRANSPARENT);
            previewParent=(ViewGroup)webView.getParent();previewView=new PreviewView(getContext());previewView.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);previewView.setClickable(false);previewView.setFocusable(false);
            int index=previewParent.indexOfChild(webView);previewParent.addView(previewView,index,previewLayoutParams(1,1,0,0));
        }
        updatePreviewBounds(bounds);
    }

    private void updatePreviewBounds(JSONObject bounds) {
        if(previewView==null||previewParent==null||bounds==null)return;
        WebView webView=getBridge().getWebView();if(webView==null)return;
        float fallback=getContext().getResources().getDisplayMetrics().density*webView.getScale();
        float scale=(float)bounds.optDouble("pixelRatio",fallback);if(!Float.isFinite(scale)||scale<=0)scale=fallback;
        previewPixelRatio=scale;
        int[] web=new int[2],parent=new int[2];webView.getLocationOnScreen(web);previewParent.getLocationOnScreen(parent);
        int left=web[0]-parent[0]+Math.round((float)bounds.optDouble("x",0)*scale);
        int top=web[1]-parent[1]+Math.round((float)bounds.optDouble("y",0)*scale);
        int width=Math.max(1,Math.round((float)bounds.optDouble("width",1)*scale));int height=Math.max(1,Math.round((float)bounds.optDouble("height",1)*scale));
        ViewGroup.LayoutParams params=previewLayoutParams(width,height,left,top);
        previewView.setLayoutParams(params);previewView.setVisibility(View.VISIBLE);
        webView.bringToFront();
        // PreviewView resizes independently. Keep the bound use-case group stable for
        // this session: rebinding on bounds changes can close ImageCapture mid-capture.
    }

    private ViewGroup.LayoutParams previewLayoutParams(int width,int height,int left,int top){
        if(previewParent instanceof CoordinatorLayout){CoordinatorLayout.LayoutParams params=new CoordinatorLayout.LayoutParams(width,height);params.gravity=Gravity.TOP|Gravity.LEFT;params.leftMargin=left;params.topMargin=top;return params;}
        if(previewParent instanceof FrameLayout){FrameLayout.LayoutParams params=new FrameLayout.LayoutParams(width,height,Gravity.TOP|Gravity.LEFT);params.leftMargin=left;params.topMargin=top;return params;}
        ViewGroup.MarginLayoutParams params=new ViewGroup.MarginLayoutParams(width,height);params.leftMargin=left;params.topMargin=top;return params;
    }

    private void removePreviewView(){if(previewView!=null&&previewParent!=null)previewParent.removeView(previewView);previewView=null;previewParent=null;if(hasSavedWebViewBackground){WebView webView=getBridge()==null?null:getBridge().getWebView();if(webView!=null)webView.setBackground(savedWebViewBackground);savedWebViewBackground=null;hasSavedWebViewBackground=false;}if(changedKeepScreenOn){getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);changedKeepScreenOn=false;}keepScreenOnWasAlreadySet=false;}
    private void lockCameraPortrait(){android.app.Activity activity=getActivity();if(activity==null)return;if(!savedRequestedOrientation){previousRequestedOrientation=activity.getRequestedOrientation();savedRequestedOrientation=true;}if(activity.getRequestedOrientation()!=ActivityInfo.SCREEN_ORIENTATION_PORTRAIT)activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);}
    private void restoreRequestedOrientation(){if(!savedRequestedOrientation)return;android.app.Activity activity=getActivity();int restore=previousRequestedOrientation;savedRequestedOrientation=false;previousRequestedOrientation=ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;if(activity!=null&&activity.getRequestedOrientation()!=restore)try{activity.setRequestedOrientation(restore);}catch(RuntimeException error){Log.w("ClearWaterCamera","Could not restore the prior screen orientation.",error);}}
    private void cleanupSessionResources(){analysisGeneration++;if(provider!=null)provider.unbindAll();closeEffect();camera=null;lastBoundLensId=null;resetZoomForLensSwitch=false;preview=null;imageCapture=null;if(imageAnalysis!=null)imageAnalysis.clearAnalyzer();imageAnalysis=null;videoCapture=null;removePreviewView();synchronized(this){latestSampleData=null;}restoreRequestedOrientation();}
    private void restoreZoom(float ratio){if(camera==null||!Float.isFinite(ratio)||ratio<=0)return;try{camera.getCameraControl().setZoomRatio(CameraLensGeometry.clampZoom(ratio,effectiveZoomBounds()));}catch(Exception ignored){}}
    private void closeEffect(){
        Media3Effect retired=media3Effect;
        if(retired==null)return;
        media3Effect=null;
        media3EffectGeneration++;
        // CameraX requires close() on the main thread, but its GL release may wait
        // for the renderer. Let unbind and the current lifecycle callback finish first.
        main.post(()->{try{retired.close();}catch(Exception error){Log.w("ClearWaterCamera","Could not release the retired camera effect.",error);}});
    }
    private void ensureOrientationListener(){if(orientationListener==null){captureRotation=displayRotation();orientationListener=new OrientationEventListener(getContext()){@Override public void onOrientationChanged(int orientation){if(orientation==ORIENTATION_UNKNOWN)return;final int rotation=rotationForOrientation(orientation);main.post(()->{if(captureRotation==rotation)return;captureRotation=rotation;updateTargetRotation();});}};}}
    private static int rotationForOrientation(int orientation){
        if(orientation>=45&&orientation<135)return Surface.ROTATION_270;
        if(orientation>=135&&orientation<225)return Surface.ROTATION_180;
        if(orientation>=225&&orientation<315)return Surface.ROTATION_90;
        return Surface.ROTATION_0;
    }
    private int displayRotation(){Display display=getActivity().getWindowManager().getDefaultDisplay();return display.getRotation();}
    private void notifyPhotoInfoChanged(){
        if(!sessionActive||recordingActive||imageCapture==null)return;
        JSObject info=new JSObject();
        info.put("sessionGeneration",sessionGeneration);
        info.put("photoWidth",photoWidth());
        info.put("photoHeight",photoHeight());
        notifyListeners("cameraInfoChanged",info);
    }
    private void updateTargetRotation(){
        int display=displayRotation();
        if(imageAnalysis!=null)imageAnalysis.setTargetRotation(display);
        if(recordingActive)return;
        if(imageCapture!=null)imageCapture.setTargetRotation(captureRotation);
        if(preview!=null)preview.setTargetRotation(display);
        if(videoCapture!=null)videoCapture.setTargetRotation(captureRotation);
        notifyPhotoInfoChanged();
    }
    private float zoomRatio(){if(camera==null||camera.getCameraInfo().getZoomState().getValue()==null)return 1f;return camera.getCameraInfo().getZoomState().getValue().getZoomRatio();}
    private float[] effectiveZoomBounds(){
        if(camera==null||camera.getCameraInfo().getZoomState().getValue()==null)return new float[]{1f,1f};
        androidx.camera.core.ZoomState state=camera.getCameraInfo().getZoomState().getValue();
        Lens lens=lenses.get(lastBoundLensId==null?selectedLensId:lastBoundLensId);
        if(lens==null||!lens.physical())return new float[]{state.getMinZoomRatio(),state.getMaxZoomRatio()};
        return CameraLensGeometry.intersectZoomBounds(state.getMinZoomRatio(),state.getMaxZoomRatio(),
            lens.metadataMinZoom,lens.metadataMaxZoom);
    }
    private int photoWidth(){return photoWidth(imageCapture);}
    private int photoHeight(){return photoHeight(imageCapture);}
    private int photoWidth(ImageCapture capture){if(capture==null||capture.getResolutionInfo()==null)return 0;androidx.camera.core.ResolutionInfo info=capture.getResolutionInfo();return info.getRotationDegrees()%180==0?info.getResolution().getWidth():info.getResolution().getHeight();}
    private int photoHeight(ImageCapture capture){if(capture==null||capture.getResolutionInfo()==null)return 0;androidx.camera.core.ResolutionInfo info=capture.getResolutionInfo();return info.getRotationDegrees()%180==0?info.getResolution().getHeight():info.getResolution().getWidth();}
    private int videoWidth(){if(videoCapture==null||videoCapture.getResolutionInfo()==null)return 0;androidx.camera.core.ResolutionInfo info=videoCapture.getResolutionInfo();return info.getRotationDegrees()%180==0?info.getResolution().getWidth():info.getResolution().getHeight();}
    private int videoHeight(){if(videoCapture==null||videoCapture.getResolutionInfo()==null)return 0;androidx.camera.core.ResolutionInfo info=videoCapture.getResolutionInfo();return info.getRotationDegrees()%180==0?info.getResolution().getHeight():info.getResolution().getWidth();}

    private JSObject sessionInfo(){
        JSObject result=new JSObject();float ratio=zoomRatio();result.put("sessionGeneration",sessionGeneration);
        float[] bounds=effectiveZoomBounds();
        minZoom=(int)Math.ceil(bounds[0]);maxZoom=(int)Math.floor(bounds[1]);
        result.put("width",previewView==null?0:Math.round(previewView.getWidth()/Math.max(.1f,previewPixelRatio)));
        result.put("height",previewView==null?0:Math.round(previewView.getHeight()/Math.max(.1f,previewPixelRatio)));
        result.put("photoWidth",photoWidth());result.put("photoHeight",photoHeight());result.put("lenses",lensArray());result.put("lensId",selectedLensId);result.put("zoom",ratio);
        result.put("minZoom",bounds[0]);
        result.put("maxZoom",bounds[1]);
        return result;
    }

    private void fail(PluginCall call,String message,Throwable error){if(error!=null)Log.e("ClearWaterCamera",message,error);if(call!=null)call.reject(message,error instanceof Exception?(Exception)error:new Exception(error));else notifyCameraError(message,error);}
    private void notifyCameraError(String message,Throwable error){if(error!=null)Log.e("ClearWaterCamera",message,error);JSObject value=new JSObject();value.put("message",message);if(error!=null)value.put("cause",error.getClass().getSimpleName());notifyListeners("cameraError",value);}

    @Override protected void handleOnPause(){super.handleOnPause();if(provider!=null&&!recordingActive){bindGeneration++;closeEffect();provider.unbindAll();}}
    @Override protected void handleOnResume(){super.handleOnResume();if(sessionActive&&provider!=null&&!recordingActive)bindIdle(pendingBindCall);}
    @Override protected void handleOnDestroy(){sessionGeneration++;bindGeneration++;sessionActive=false;if(recording!=null){recordingDiscard=true;recording.stop();}if(orientationListener!=null)orientationListener.disable();cleanupSessionResources();synchronized(temporaryCaptures){for(File file:temporaryCaptures.values())if(file!=null&&file.exists())file.delete();temporaryCaptures.clear();}analysisExecutor.shutdownNow();super.handleOnDestroy();}
}
