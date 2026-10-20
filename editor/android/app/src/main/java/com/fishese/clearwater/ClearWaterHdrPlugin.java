package com.fishese.clearwater;

import android.net.Uri;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.transformer.Effects;
import androidx.media3.effect.Presentation;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.DefaultEncoderFactory;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.EditedMediaItemSequence;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.ProgressHolder;
import androidx.media3.transformer.Transformer;
import androidx.media3.transformer.VideoEncoderSettings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.Collections;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Android-only, app-private staging and HDR-to-SDR working-copy conversion. */
@CapacitorPlugin(name = "ClearWaterHdr")
public class ClearWaterHdrPlugin extends Plugin {
    private static final String TAG = "ClearWaterHdr";
    private static final long MAX_INPUT_BYTES = 512L * 1024 * 1024;
    private static final long MAX_OUTPUT_BYTES = 256L * 1024 * 1024;
    private static final long MAX_DURATION_US = 600_000_000L;
    /** Matches videoDurationToleranceSeconds (0.001) in editor/src/core/platform-limits.ts. */
    private static final long DURATION_TOLERANCE_US = 1_000L;
    private static final long MAX_FRAME_PIXELS = 34_000_000L;
    private static final int CHUNK_BYTES = 256 * 1024;

    /** Machine-readable ceiling. JS formats it from the android-apk row in platform-limits.ts. */
    private static String limitToken(String code, String unit, long actual, long limit) {
        String token = "cw-limit/" + code + "/" + unit + "/" + actual + "/" + limit;
        Log.w(TAG, token);
        return token;
    }

    private static String frameToken(int width, int height) {
        String token = "cw-limit/resolution/frame/" + width + "/" + height + "/" + MAX_FRAME_PIXELS;
        Log.w(TAG, token);
        return token;
    }

    private static boolean isEncoderOrMemory(Throwable error) {
        Throwable current = error;
        while (current != null) {
            if (current instanceof OutOfMemoryError) return true;
            String name = current.getClass().getSimpleName().toLowerCase(Locale.ROOT);
            String message = current.getMessage() == null ? "" : current.getMessage().toLowerCase(Locale.ROOT);
            if (name.contains("outofmemory") || message.contains("out of memory") || message.contains("failed to allocate")
                || message.contains("encoder init") || message.contains("encoder failed")) return true;
            current = current.getCause();
        }
        return false;
    }
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, InputSession> inputSessions = new ConcurrentHashMap<>();
    private final Map<String, File> readyInputs = new ConcurrentHashMap<>();
    private final Map<String, File> outputs = new ConcurrentHashMap<>();
    private final Map<String, ConversionJob> jobs = new ConcurrentHashMap<>();
    private final Set<String> pendingCancels = new HashSet<>();

    private static int videoBitrate(long durationUs) {
        double durationSeconds = Math.max(1d, durationUs / 1_000_000d);
        long budgetedBitrate = (long)(MAX_OUTPUT_BYTES * 0.8d * 8d / durationSeconds - 256_000d);
        return (int)Math.min(8_000_000L, Math.max(500_000L, budgetedBitrate));
    }

    private static final class InputSession {
        File file;
        final FileOutputStream stream;
        final long expected;
        long written;
        String extension;
        InputSession(File file, FileOutputStream stream, long expected) { this.file=file;this.stream=stream;this.expected=expected; }
    }

    private static final class ConversionJob {
        final String id;
        final File input;
        final File output;
        final PluginCall call;
        Transformer transformer;
        Runnable progress;
        boolean finished;
        ConversionJob(String id, File input, File output, PluginCall call) { this.id=id;this.input=input;this.output=output;this.call=call; }
    }

    private File workingDirectory() throws IOException {
        File directory = new File(getContext().getCacheDir(), "hdr-working-copies");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("No temporary storage is available.");
        return directory;
    }

    private void cleanStaleFiles() throws IOException {
        synchronized (jobs) {
            File[] files = workingDirectory().listFiles();
            if (files == null) throw new IOException("Could not inspect temporary video storage.");
            Set<File> active = new HashSet<>();
            for (InputSession session : inputSessions.values()) active.add(session.file);
            active.addAll(readyInputs.values());
            active.addAll(outputs.values());
            for (ConversionJob job : jobs.values()) { active.add(job.input); active.add(job.output); }
            for (File file : files) {
                if (file.isFile() && !active.contains(file) && !file.delete())
                    throw new IOException("Could not clear old temporary video data. Check available storage.");
            }
        }
    }

    private static void rejectStaging(PluginCall call, String operation, String fallback, Exception error) {
        String message = error instanceof IOException && error.getMessage() != null
            ? error.getMessage() : fallback;
        // Avoid logging paths, file names, and exception messages from the platform.
        Throwable cause = error.getCause();
        Log.w(TAG, operation + " failed (" + error.getClass().getSimpleName()
            + (cause == null ? "" : "/" + cause.getClass().getSimpleName()) + "): " + message);
        call.reject(message);
    }

    private static IOException storageFailure(String action, IOException cause) {
        String raw = cause.getMessage();
        String detail = raw == null ? "" : raw.toLowerCase(Locale.ROOT);
        String reason;
        if (detail.contains("enospc") || detail.contains("no space left")) reason = "no space left on this device";
        else if (detail.contains("eacces") || detail.contains("permission denied")) reason = "storage access was denied";
        else if (detail.contains("erofs") || detail.contains("read-only file system")) reason = "storage is read-only";
        else if (detail.contains("emfile") || detail.contains("too many open files")) reason = "too many files are open";
        else if (detail.contains("eio") || detail.contains("i/o error")) reason = "a storage I/O error occurred";
        else reason = "temporary storage is unavailable";
        return new IOException("Could not " + action + ": " + reason + ".", cause);
    }

    @PluginMethod public void beginHdrInput(PluginCall call) {
        io.execute(() -> {
            try {
                long size = call.getLong("size", -1L);
                if (Build.VERSION.SDK_INT < 29) throw new IOException("HDR-to-SDR conversion requires Android 10 or later.");
                if (size <= 0 || size > MAX_INPUT_BYTES) throw new IOException(limitToken("too-large", "bytes", Math.max(0L, size), MAX_INPUT_BYTES));
                cleanStaleFiles();
                String id = UUID.randomUUID().toString();
                File file = new File(workingDirectory(), "source-" + id + ".stage");
                FileOutputStream stream;
                try { stream = new FileOutputStream(file); }
                catch (IOException error) {
                    file.delete();
                    throw storageFailure("create temporary video storage", error);
                }
                synchronized (jobs) { inputSessions.put(id, new InputSession(file, stream, size)); }
                JSObject result = new JSObject(); result.put("id", id); call.resolve(result);
            } catch (Exception error) { rejectStaging(call, "begin", "Could not prepare temporary video storage. Check available storage.", error); }
        });
    }

    @PluginMethod public void writeHdrInputChunk(PluginCall call) {
        io.execute(() -> {
            try {
                InputSession session = inputSessions.get(call.getString("id"));
                String encoded = call.getString("data");
                if (session == null || encoded == null || encoded.length() > 350000) throw new IOException("Invalid temporary video write.");
                byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
                if (bytes.length > CHUNK_BYTES || session.written + bytes.length > session.expected) throw new IOException("Invalid temporary video size.");
                if (session.written == 0) session.extension = HdrContainer.extension(bytes);
                try { session.stream.write(bytes); }
                catch (IOException error) { throw storageFailure("write temporary video data", error); }
                session.written += bytes.length; call.resolve();
            } catch (Exception error) {
                String id = call.getString("id"); InputSession failed;
                synchronized (jobs) {
                    failed = id == null ? null : inputSessions.remove(id);
                    if (id != null) pendingCancels.remove(id);
                }
                if (failed != null) {
                    try { failed.stream.close(); } catch (IOException ignored) { }
                    failed.file.delete();
                }
                rejectStaging(call, "write", "Could not stage the video for conversion.", error);
            }
        });
    }

    @PluginMethod public void finishHdrInput(PluginCall call) {
        io.execute(() -> {
            String id = call.getString("id"); InputSession session;
            synchronized (jobs) { session = id == null ? null : inputSessions.get(id); }
            if (session == null) { call.reject("Temporary video write is closed."); return; }
            boolean abort = call.getBoolean("abort", false);
            try {
                try { session.stream.close(); }
                catch (IOException error) { throw storageFailure("finish temporary video data", error); }
                boolean cancelled;
                boolean incomplete = session.written != session.expected || session.extension == null;
                synchronized (jobs) {
                    inputSessions.remove(id);
                    cancelled = pendingCancels.remove(id);
                    if (!abort && !cancelled && !incomplete) {
                        File staged = new File(workingDirectory(), "source-" + id + session.extension);
                        if (!session.file.renameTo(staged)) throw new IOException("Could not finish temporary video storage. Check available storage.");
                        session.file = staged;
                        readyInputs.put(id, staged);
                    }
                }
                if (abort || cancelled || incomplete) {
                    if (!session.file.delete()) Log.w(TAG, "finish could not remove temporary input");
                    if (abort) call.resolve(); else if (cancelled) call.reject("HDR conversion was cancelled.");
                    else call.reject("The temporary video copy is incomplete.");
                    return;
                }
                call.resolve();
            } catch (Exception error) {
                synchronized (jobs) { inputSessions.remove(id); pendingCancels.remove(id); }
                session.file.delete();
                rejectStaging(call, "finish", "Could not finish staging the video.", error);
            }
        });
    }

    @UnstableApi
    @PluginMethod public void convertHdrToSdr(PluginCall call) {
        String id = call.getString("id");
        File input; ConversionJob job;
        if (Build.VERSION.SDK_INT < 29) { call.reject("HDR-to-SDR conversion requires Android 10 or later."); return; }
        try {
            synchronized (jobs) {
                input = readyInputs.get(id);
                if (input == null || !input.isFile()) { call.reject("The staged video is missing."); return; }
                if (pendingCancels.remove(id)) { readyInputs.remove(id); input.delete(); call.reject("HDR conversion was cancelled."); return; }
                File output = new File(workingDirectory(), "sdr-working-copy-" + UUID.randomUUID() + ".mp4");
                job = new ConversionJob(id, input, output, call);
                jobs.put(id, job);
                readyInputs.remove(id);
            }
            main.post(() -> startConversion(job));
        } catch (Exception error) { input = readyInputs.remove(id); if (input != null) input.delete(); call.reject("Could not prepare the SDR working copy.", error); }
    }

    @UnstableApi private void startConversion(ConversionJob job) {
        if (job.finished) return;
        try {
            MediaExtractor extractor = new MediaExtractor();
            int width = 0, height = 0, rotation = 0; long durationUs = -1;
            try {
                extractor.setDataSource(job.input.getAbsolutePath());
                for (int i = 0; i < extractor.getTrackCount(); i++) {
                    MediaFormat format = extractor.getTrackFormat(i);
                    if (format.containsKey(MediaFormat.KEY_MIME) && format.getString(MediaFormat.KEY_MIME).startsWith("video/")) {
                        width = format.containsKey(MediaFormat.KEY_WIDTH) ? format.getInteger(MediaFormat.KEY_WIDTH) : 0;
                        height = format.containsKey(MediaFormat.KEY_HEIGHT) ? format.getInteger(MediaFormat.KEY_HEIGHT) : 0;
                        rotation = format.containsKey(MediaFormat.KEY_ROTATION) ? format.getInteger(MediaFormat.KEY_ROTATION) : 0;
                        durationUs = format.containsKey(MediaFormat.KEY_DURATION) ? format.getLong(MediaFormat.KEY_DURATION) : -1;
                        break;
                    }
                }
            } finally { extractor.release(); }
            if (durationUs <= 0 || width <= 0 || height <= 0) throw new IOException("cw-limit/unreadable");
            if (durationUs > MAX_DURATION_US + DURATION_TOLERANCE_US) {
                String token = String.format(Locale.US, "cw-limit/too-long/seconds/%.3f/%d", durationUs / 1_000_000d, MAX_DURATION_US / 1_000_000L);
                Log.w(TAG, token);
                throw new IOException(token);
            }
            MediaItem mediaItem = MediaItem.fromUri(Uri.fromFile(job.input));
            if (rotation % 90 != 0) throw new IOException("This video's rotation metadata is not supported.");
            // Display size, same as the editor's getDisplayWidth/Height. A quarter turn swaps axes; the pixel count does not change.
            int displayWidth = width, displayHeight = height;
            if (Math.floorMod(rotation, 180) != 0) { displayWidth = height; displayHeight = width; }
            if ((long)displayWidth * displayHeight > MAX_FRAME_PIXELS) throw new IOException(frameToken(displayWidth, displayHeight));
            int longSide = Math.max(displayWidth, displayHeight), shortSide = Math.min(displayWidth, displayHeight);
            float scale = Math.min(1f, Math.min(1920f / longSide, 1080f / shortSide));
            int outputWidth = Math.max(2, ((int)Math.floor(displayWidth * scale / 2f)) * 2);
            int outputHeight = Math.max(2, ((int)Math.floor(displayHeight * scale / 2f)) * 2);
            Effects videoEffects = new Effects(Collections.emptyList(), Collections.singletonList(
                Presentation.createForWidthAndHeight(outputWidth, outputHeight, Presentation.LAYOUT_SCALE_TO_FIT)));
            EditedMediaItem edited = new EditedMediaItem.Builder(mediaItem).setFrameRate(30).setEffects(videoEffects).build();
            EditedMediaItemSequence sequence = EditedMediaItemSequence.withAudioAndVideoFrom(Collections.singletonList(edited));
            Composition composition = new Composition.Builder(Collections.singletonList(sequence))
                .setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL)
                .build();
            Transformer.Listener listener = new Transformer.Listener() {
                @Override public void onCompleted(@NonNull Composition ignored, @NonNull ExportResult result) {
                    finishConversion(job, true, null);
                }
                @Override public void onError(@NonNull Composition ignored, @NonNull ExportResult result, @NonNull ExportException error) {
                    finishConversion(job, false, error);
                }
            };
            job.transformer = new Transformer.Builder(getContext())
                .setVideoMimeType(MimeTypes.VIDEO_H264)
                .setAudioMimeType(MimeTypes.AUDIO_AAC)
                .setEncoderFactory(new DefaultEncoderFactory.Builder(getContext())
                    .setRequestedVideoEncoderSettings(new VideoEncoderSettings.Builder()
                        .setBitrate(videoBitrate(durationUs))
                        .build())
                    .build())
                .addListener(listener)
                .build();
            job.transformer.start(composition, job.output.getAbsolutePath());
            ProgressHolder holder = new ProgressHolder();
            job.progress = new Runnable() {
                @Override public void run() {
                    if (job.finished || job.transformer == null) return;
                    if (job.output.length() > MAX_OUTPUT_BYTES) {
                        try { job.transformer.cancel(); } catch (Exception ignored) { }
                        finishConversion(job, false, new IOException(limitToken("too-large", "bytes", job.output.length(), MAX_OUTPUT_BYTES)));
                        return;
                    }
                    int state = job.transformer.getProgress(holder);
                    if (state == Transformer.PROGRESS_STATE_AVAILABLE) {
                        JSObject event = new JSObject(); event.put("id", job.id); event.put("progress", holder.progress);
                        notifyListeners("hdrConversionProgress", event);
                    }
                    main.postDelayed(this, 500);
                }
            };
            main.post(job.progress);
        } catch (Exception error) { finishConversion(job, false, error); }
    }

    private void finishConversion(ConversionJob job, boolean success, Exception error) {
        if (job.finished) return;
        job.finished = true;
        if (job.progress != null) main.removeCallbacks(job.progress);
        job.input.delete();
        if (success && job.output.isFile() && job.output.length() > 0 && job.output.length() <= MAX_OUTPUT_BYTES) {
            synchronized (jobs) { jobs.remove(job.id); pendingCancels.remove(job.id); outputs.put(job.id, job.output); }
            JSObject result = new JSObject(); result.put("id", job.id); result.put("uri", Uri.fromFile(job.output).toString()); callResolve(job.call, result);
        } else {
            synchronized (jobs) { jobs.remove(job.id); pendingCancels.remove(job.id); }
            job.output.delete();
            Exception failure = error;
            if (success && failure == null) failure = new IOException(limitToken("too-large", "bytes", job.output.length(), MAX_OUTPUT_BYTES));
            String raw = failure == null || failure.getMessage() == null ? "" : failure.getMessage();
            String message = failure == null ? "HDR conversion was cancelled."
                : raw.startsWith("cw-limit/") ? raw
                : isEncoderOrMemory(failure) ? "cw-limit/out-of-memory"
                : "This device could not tone-map this HDR video. Try an SDR copy or a supported Android 10+ device.";
            callReject(job.call, message, failure);
        }
    }

    private void callResolve(PluginCall call, JSObject result) { main.post(() -> call.resolve(result)); }
    private void callReject(PluginCall call, String message, Exception error) { main.post(() -> { if (error != null) Log.w(TAG, "reject", error); else Log.w(TAG, message); if (error == null) call.reject(message); else call.reject(message, error); }); }

    @PluginMethod public void cancelHdrConversion(PluginCall call) {
        String id = call.getString("id"); ConversionJob job;
        if (id == null) { call.resolve(); return; }
        synchronized (jobs) {
            job = jobs.get(id);
            if (job == null) {
                File ready = readyInputs.remove(id);
                if (ready != null) ready.delete();
                else if (inputSessions.containsKey(id)) pendingCancels.add(id);
            }
        }
        if (job == null) io.execute(() -> {
            InputSession session; File ready;
            synchronized (jobs) {
                session = inputSessions.remove(id);
                ready = readyInputs.remove(id);
                pendingCancels.remove(id);
            }
            if (session != null) {
                try { session.stream.close(); } catch (IOException ignored) { }
                session.file.delete();
            }
            if (ready != null) ready.delete();
        });
        if (job != null) main.post(() -> {
            if (job.finished) return;
            try { if (job.transformer != null) job.transformer.cancel(); } catch (Exception ignored) { }
            finishConversion(job, false, null);
        });
        call.resolve();
    }

    @PluginMethod public void deleteHdrWorkingCopy(PluginCall call) {
        io.execute(() -> {
            String id = call.getString("id"); File file; synchronized (jobs) { file = outputs.remove(id); }
            synchronized (jobs) { pendingCancels.remove(id); }
            if (file != null && file.getParentFile().equals(new File(getContext().getCacheDir(), "hdr-working-copies"))) file.delete();
            call.resolve();
        });
    }

    @Override protected void handleOnDestroy() {
        for (ConversionJob job : jobs.values()) main.post(() -> {
            try { if (job.transformer != null) job.transformer.cancel(); } catch (Exception ignored) { }
            finishConversion(job, false, null);
        });
        io.execute(() -> {
            synchronized (jobs) {
                for (InputSession session : inputSessions.values()) {
                    try { session.stream.close(); } catch (IOException ignored) { }
                    session.file.delete();
                }
                inputSessions.clear();
                for (File file : readyInputs.values()) file.delete();
                readyInputs.clear();
                for (File file : outputs.values()) file.delete();
                outputs.clear();
                pendingCancels.clear();
            }
        });
        io.shutdown();
        super.handleOnDestroy();
    }
}
