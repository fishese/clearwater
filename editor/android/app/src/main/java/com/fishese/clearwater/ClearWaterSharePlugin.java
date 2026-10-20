package com.fishese.clearwater;

import android.content.ClipData;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;

/** Streams completed editor exports into private cache before handing a read-only URI to Android's chooser. */
@CapacitorPlugin(name = "ClearWaterShare")
public class ClearWaterSharePlugin extends Plugin {
    private static final long MAX_BYTES = 512L * 1024L * 1024L;
    private static final long MAX_CACHE_BYTES = 1024L * 1024L * 1024L;
    private static final long RETAIN_MS = 24L * 60L * 60L * 1000L;
    private static final long MIN_RECENT_MS = 15L * 60L * 1000L;
    private static final int MAX_CHUNK_BYTES = 256 * 1024;
    private static final String SHARE_DIR = "clearwater-shares";
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Map<String, Stage> stages = new ConcurrentHashMap<>();

    private static final class Stage {
        final File partial;
        final File finished;
        final FileOutputStream stream;
        final long expected;
        final String name;
        final String type;
        long written;
        Stage(File partial, File finished, FileOutputStream stream, long expected, String name, String type) {
            this.partial = partial; this.finished = finished; this.stream = stream; this.expected = expected; this.name = name; this.type = type;
        }
    }

    private File shareDirectory() throws IOException {
        File directory = new File(getContext().getCacheDir(), SHARE_DIR);
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Could not prepare private share storage.");
        return directory;
    }

    private void cleanExpired() {
        File directory = new File(getContext().getCacheDir(), SHARE_DIR);
        File[] files = directory.listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - RETAIN_MS;
        for (File file : files) {
            if (file.lastModified() < cutoff && !isActive(file)) file.delete();
        }
    }

    private void ensureCapacity(long incoming) throws IOException {
        File directory = shareDirectory();
        File[] listed = directory.listFiles();
        if (listed == null) return;
        List<File> evictable = new ArrayList<>();
        long used = 0, cutoff = System.currentTimeMillis() - MIN_RECENT_MS;
        for (File file : listed) {
            if (!file.isFile()) continue;
            used += file.length();
            if (!isActive(file) && file.lastModified() < cutoff) evictable.add(file);
        }
        evictable.sort(Comparator.comparingLong(File::lastModified));
        for (File file : evictable) {
            if (used + incoming <= MAX_CACHE_BYTES) break;
            long size = file.length();
            if (file.delete()) used -= size;
        }
        if (used + incoming > MAX_CACHE_BYTES) throw new IOException("Private share storage is full. Try again later.");
    }

    private boolean isActive(File file) {
        for (Stage stage : stages.values()) if (stage.partial.equals(file) || stage.finished.equals(file)) return true;
        return false;
    }

    private static String safeName(String value) throws IOException {
        if (value == null || value.isEmpty() || value.length() > 220 || !value.equals(value.trim()) || value.equals(".") || value.equals("..")) throw new IOException("Invalid share file name.");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '/' || c == '\\' || c < 0x20 || c == 0x7f) throw new IOException("Invalid share file name.");
        }
        return value;
    }

    private static String safeType(String value, String name) throws IOException {
        String type = value == null ? "" : value.toLowerCase(Locale.ROOT).trim();
        String lowerName = name.toLowerCase(Locale.ROOT);
        boolean match = (type.equals("image/jpeg") && (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")))
            || (type.equals("image/png") && lowerName.endsWith(".png"))
            || (type.equals("video/mp4") && lowerName.endsWith(".mp4"));
        if (!match) throw new IOException("Unsupported share file type.");
        return type;
    }

    @PluginMethod public void beginShare(PluginCall call) {
        io.execute(() -> {
            try {
                cleanExpired();
                String name = safeName(call.getString("name"));
                String type = safeType(call.getString("type"), name);
                long size = call.getLong("size", -1L);
                if (size <= 0 || size > MAX_BYTES) {
                    String code = "video/mp4".equals(type) ? "too-large" : "photo-too-large";
                    String token = "cw-limit/" + code + "/bytes/" + Math.max(0L, size) + "/" + MAX_BYTES;
                    Log.w("ClearWaterShare", token);
                    throw new IOException(token);
                }
                ensureCapacity(size);
                String id = UUID.randomUUID().toString();
                File directory = shareDirectory();
                File partial = new File(directory, id + ".partial");
                String extension = type.equals("image/png") ? ".png" : type.equals("video/mp4") ? ".mp4" : ".jpg";
                File finished = new File(directory, id + extension);
                Stage stage = new Stage(partial, finished, new FileOutputStream(partial), size, name, type);
                stages.put(id, stage);
                JSObject result = new JSObject(); result.put("id", id); call.resolve(result);
            } catch (Exception error) {
                Log.w("ClearWaterShare", "beginShare failed", error);
                String raw = error.getMessage() == null ? "" : error.getMessage();
                call.reject(raw.startsWith("cw-limit/") ? raw : "Could not prepare the file for sharing.", error);
            }
        });
    }

    @PluginMethod public void writeShareChunk(PluginCall call) {
        io.execute(() -> {
            String id = call.getString("id");
            Stage stage = stages.get(id);
            try {
                if (stage == null) throw new IOException("Share transfer is no longer active.");
                String encoded = call.getString("data");
                if (encoded == null || encoded.length() > 4 * ((MAX_CHUNK_BYTES + 2) / 3)) throw new IOException("Invalid share data chunk.");
                byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                if (bytes.length == 0 || bytes.length > MAX_CHUNK_BYTES || stage.written + bytes.length > stage.expected) throw new IOException("Invalid share data chunk size.");
                stage.stream.write(bytes); stage.written += bytes.length; call.resolve();
            } catch (Exception error) { discard(id, stage); call.reject("Could not stage the file for sharing.", error); }
        });
    }

    @PluginMethod public void finishShare(PluginCall call) {
        io.execute(() -> {
            String id = call.getString("id");
            Stage stage = stages.get(id);
            try {
                if (stage == null) throw new IOException("Share transfer is no longer active.");
                if (stage.written != stage.expected) throw new IOException("The shared file was incomplete.");
                stage.stream.getFD().sync(); stage.stream.close();
                if (!stage.partial.renameTo(stage.finished)) throw new IOException("Could not finish the staged file.");
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", stage.finished, stage.name);
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(stage.type);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.setClipData(ClipData.newUri(getContext().getContentResolver(), stage.name, uri));
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Activity activity = getActivity();
                if (activity == null) throw new IOException("Could not open the Android share menu.");
                activity.runOnUiThread(() -> {
                    if (activity.isFinishing() || activity.isDestroyed()) {
                        enqueueIo(() -> { discard(id, stage); call.reject("Could not open the Android share menu."); });
                        return;
                    }
                    try {
                        Intent chooser = Intent.createChooser(send, null);
                        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        activity.startActivity(chooser);
                        stage.finished.setLastModified(System.currentTimeMillis());
                        enqueueIo(() -> { stages.remove(id); call.resolve(); });
                    } catch (Exception error) { enqueueIo(() -> { discard(id, stage); call.reject("Could not open the Android share menu.", error); }); }
                });
            } catch (Exception error) { discard(id, stage); call.reject("Could not finish the file for sharing.", error); }
        });
    }

    @PluginMethod public void cancelShare(PluginCall call) {
        io.execute(() -> { String id = call.getString("id"); discard(id, stages.get(id)); call.resolve(); });
    }

    private void discard(String id, Stage stage) {
        if (id != null) stages.remove(id);
        if (stage == null) return;
        try { stage.stream.close(); } catch (Exception ignored) { }
        stage.partial.delete(); stage.finished.delete();
    }

    private void enqueueIo(Runnable task) {
        if (io.isShutdown()) return;
        try { io.execute(task); } catch (RejectedExecutionException ignored) { }
    }

    @Override protected void handleOnDestroy() {
        io.execute(() -> {
            for (Map.Entry<String, Stage> entry : stages.entrySet()) {
                Stage stage = entry.getValue();
                try { stage.stream.close(); } catch (Exception ignored) { }
                stage.partial.delete();
            }
            stages.clear();
        });
        io.shutdown();
        super.handleOnDestroy();
    }
}
