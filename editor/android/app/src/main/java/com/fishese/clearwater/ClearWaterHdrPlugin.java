package com.fishese.clearwater;

import android.net.Uri;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
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
    private static final long MAX_INPUT_BYTES = 512L * 1024 * 1024;
    private static final long MAX_OUTPUT_BYTES = 256L * 1024 * 1024;
    private static final long MAX_DURATION_US = 600_000_000L;
    private static final long MAX_FRAME_PIXELS = 34_000_000L;
    private static final int CHUNK_BYTES = 256 * 1024;
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
        final File file;
        final FileOutputStream stream;
        final long expected;
        long written;
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
            if (!jobs.isEmpty() || !outputs.isEmpty() || !readyInputs.isEmpty() || !inputSessions.isEmpty())
                throw new IOException("An HDR working copy is already in progress.");
        }
        File directory = workingDirectory();
        File[] files = directory.listFiles();
        if (files != null) for (File file : files) {
            if (file.isFile() && !file.delete()) throw new IOException("Could not clear old temporary video data.");
        }
    }

    @PluginMethod public void beginHdrInput(PluginCall call) {
        io.execute(() -> {
            try {
                long size = call.getLong("size", -1L);
                String name = call.getString("name", "video.mp4").toLowerCase(Locale.ROOT);
                String extension = name.endsWith(".mov") ? ".mov" : name.endsWith(".mp4") ? ".mp4" : null;
                if (Build.VERSION.SDK_INT < 29) throw new IOException("HDR-to-SDR conversion requires Android 10 or later.");
                if (size <= 0 || size > MAX_INPUT_BYTES) throw new IOException("Videos must be no larger than 512 MB.");
                if (extension == null) throw new IOException("Only MP4 and MOV videos can be converted.");
                cleanStaleFiles();
                String id = UUID.randomUUID().toString();
                File file = new File(workingDirectory(), "source-" + id + extension);
                FileOutputStream stream = new FileOutputStream(file);
                inputSessions.put(id, new InputSession(file, stream, size));
                JSObject result = new JSObject(); result.put("id", id); call.resolve(result);
            } catch (Exception error) { call.reject("Could not prepare a temporary video copy.", error); }
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
                session.stream.write(bytes); session.written += bytes.length; call.resolve();
            } catch (Exception error) { call.reject("Could not stage the video for conversion.", error); }
        });
    }

    @PluginMethod public void finishHdrInput(PluginCall call) {
        io.execute(() -> {
            String id = call.getString("id"); InputSession session = inputSessions.remove(id);
            if (session == null) { call.reject("Temporary video write is closed."); return; }
            boolean abort = call.getBoolean("abort", false);
            try {
                session.stream.close();
                if (abort || session.written != session.expected) {
                    synchronized (jobs) { pendingCancels.remove(id); }
                    session.file.delete();
                    if (abort) call.resolve(); else call.reject("The temporary video copy is incomplete.");
                    return;
                }
                readyInputs.put(id, session.file); call.resolve();
            } catch (Exception error) { session.file.delete(); call.reject("Could not finish staging the video.", error); }
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
                if (pendingCancels.remove(id)) { input.delete(); call.reject("HDR conversion was cancelled."); return; }
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
            if (durationUs <= 0 || durationUs > MAX_DURATION_US) throw new IOException("Video clips can be up to 10 minutes long.");
            if (width <= 0 || height <= 0 || (long)width * height > MAX_FRAME_PIXELS) throw new IOException("This video resolution is too large for the editor. Use a smaller copy.");
            MediaItem mediaItem = MediaItem.fromUri(Uri.fromFile(job.input));
            if (rotation % 90 != 0) throw new IOException("This video's rotation metadata is not supported.");
            int displayWidth = width, displayHeight = height;
            if (Math.floorMod(rotation, 180) != 0) { displayWidth = height; displayHeight = width; }
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
                        finishConversion(job, false, new IOException("The SDR working copy exceeded the 256 MB export limit."));
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
            if (success && failure == null) failure = new IOException("The SDR working copy exceeded the 256 MB export limit.");
            String message = failure == null ? "HDR conversion was cancelled." : failure.getMessage() != null && failure.getMessage().contains("256 MB")
                ? "The SDR working copy exceeded the 256 MB export limit."
                : "This device could not tone-map this HDR video. Try an SDR copy or a supported Android 10+ device.";
            callReject(job.call, message, failure);
        }
    }

    private void callResolve(PluginCall call, JSObject result) { main.post(() -> call.resolve(result)); }
    private void callReject(PluginCall call, String message, Exception error) { main.post(() -> { if (error == null) call.reject(message); else call.reject(message, error); }); }

    @PluginMethod public void cancelHdrConversion(PluginCall call) {
        String id = call.getString("id"); ConversionJob job;
        synchronized (jobs) {
            job = jobs.get(id);
            if (job == null) {
                File ready = readyInputs.remove(id);
                if (ready != null) ready.delete();
                else if (inputSessions.containsKey(id)) pendingCancels.add(id);
            }
        }
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
        io.shutdownNow();
        super.handleOnDestroy();
    }
}
