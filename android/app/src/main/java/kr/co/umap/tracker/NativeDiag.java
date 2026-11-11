package kr.co.umap.tracker;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 24h diagnostic ring for the background location service.
 * Rows have no coordinates. Repeated reasons in the same minute collapse into one row.
 */
public final class NativeDiag {
    private static final long WINDOW_MS = 24L * 60L * 60L * 1000L;
    private static final int MAX_EVENTS = 1_500;
    private static final int MAX_BYTES = 160_000;
    private static final String FILE_NAME = "native-diag.json";
    private static final Object LOCK = new Object();
    private static final ArrayList<JSONObject> events = new ArrayList<>();
    private static boolean loaded = false;
    private static int sinceFlush = 0;
    private static long lastFlushAt = 0L;

    private NativeDiag() {}

    public static void note(Context context, String kind, String reason, int accM, long ageMs, int distM, long dtMs, boolean recorded, String upload, int points, int http) {
        if (context == null || kind == null || kind.isEmpty()) return;
        long now = System.currentTimeMillis();
        int accBand = accM < 0 ? -1 : (accM / 20) * 20;
        long ageBand = ageMs < 0 ? -1L : (ageMs / 15_000L) * 15_000L;
        int distBand = distM < 0 ? -1 : (distM / 25) * 25;
        long dtBand = dtMs < 0 ? -1L : (dtMs / 15_000L) * 15_000L;
        String key = kind + "|" + (reason == null ? "" : reason) + "|" + accBand + "|" + ageBand + "|" + distBand + "|" + dtBand + "|" + (recorded ? 1 : 0) + "|" + (upload == null ? "" : upload) + "|" + http;
        synchronized (LOCK) {
            load(context);
            long minute = now / 60_000L;
            JSONObject previous = events.isEmpty() ? null : events.get(events.size() - 1);
            try {
                if (previous != null && key.equals(previous.optString("k")) && previous.optLong("b") == minute) {
                    previous.put("n", previous.optInt("n", 1) + 1);
                    previous.put("t", now);
                } else {
                    JSONObject row = new JSONObject();
                    row.put("t", now);
                    row.put("k", key);
                    row.put("kind", kind);
                    row.put("b", minute);
                    row.put("n", 1);
                    if (reason != null && !reason.isEmpty()) row.put("reason", reason);
                    if (accBand >= 0) row.put("acc", accBand);
                    if (ageBand >= 0) row.put("age", ageBand);
                    if (distBand >= 0) row.put("dist", distBand);
                    if (dtBand >= 0) row.put("dt", dtBand);
                    row.put("recorded", recorded);
                    if (upload != null && !upload.isEmpty()) row.put("upload", upload);
                    if (points >= 0) row.put("points", points);
                    if (http != 0) row.put("http", http);
                    events.add(row);
                }
            } catch (Exception ignored) {
                return;
            }
            trim(now);
            sinceFlush += 1;
            if (sinceFlush >= 20 || now - lastFlushAt >= 30_000L) flush(context);
        }
    }

    public static String readJson(Context context) {
        synchronized (LOCK) {
            if (context != null) {
                load(context);
                flush(context);
            }
            JSONArray copy = new JSONArray();
            for (JSONObject row : events) copy.put(row);
            return copy.toString();
        }
    }

    public static void clear(Context context) {
        synchronized (LOCK) {
            events.clear();
            loaded = true;
            sinceFlush = 0;
            lastFlushAt = 0L;
            if (context == null) return;
            File dir = context.getFilesDir();
            for (String name : new String[] { FILE_NAME, FILE_NAME + ".bak", FILE_NAME + ".tmp" }) {
                File file = new File(dir, name);
                if (file.exists() && !file.delete()) file.deleteOnExit();
            }
        }
    }

    private static void load(Context context) {
        if (loaded) return;
        loaded = true;
        String raw = readCommitted(new File(context.getFilesDir(), FILE_NAME), MAX_BYTES * 2);
        if (raw == null || raw.isEmpty()) return;
        try {
            JSONArray stored = new JSONArray(raw);
            long now = System.currentTimeMillis();
            for (int index = 0; index < stored.length(); index += 1) {
                JSONObject row = stored.optJSONObject(index);
                if (row == null || row.has("lat") || row.has("lng")) continue;
                if (now - row.optLong("t") > WINDOW_MS) continue;
                events.add(row);
            }
        } catch (Exception ignored) {
            events.clear();
        }
        trim(System.currentTimeMillis());
    }

    private static void trim(long now) {
        while (!events.isEmpty() && now - events.get(0).optLong("t") > WINDOW_MS) events.remove(0);
        while (events.size() > MAX_EVENTS) events.remove(0);
        while (events.size() > 1 && jsonBytes() > MAX_BYTES) events.remove(0);
    }

    private static int jsonBytes() {
        int bytes = 2;
        for (JSONObject row : events) bytes += row.toString().length() + 1;
        return bytes;
    }

    private static void flush(Context context) {
        sinceFlush = 0;
        lastFlushAt = System.currentTimeMillis();
        if (context == null) return;
        File dest = new File(context.getFilesDir(), FILE_NAME);
        File tmp = new File(context.getFilesDir(), FILE_NAME + ".tmp");
        try (OutputStream output = new FileOutputStream(tmp)) {
            output.write(readArray().getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {
            return;
        }
        commitFile(tmp, dest);
    }

    /** Move tmp into place. The previous file stays as .bak until the new name is in place. */
    static boolean commitFile(File tmp, File dest) {
        if (tmp == null || dest == null || !tmp.isFile()) return false;
        File dir = dest.getParentFile();
        File bak = new File(dir, dest.getName() + ".bak");
        if (bak.exists() && !bak.delete()) return false;
        if (dest.exists() && !dest.renameTo(bak)) return false;
        if (!tmp.renameTo(dest)) {
            if (!dest.exists() && bak.exists()) bak.renameTo(dest);
            return false;
        }
        if (bak.exists() && !bak.delete()) bak.deleteOnExit();
        return true;
    }

    static String readCommitted(File dest, int cap) {
        if (dest == null) return "";
        File dir = dest.getParentFile();
        // dest is the committed file. If it is missing, tmp was written and the
        // process died before the rename, so tmp is newer than bak.
        if (dest.isFile()) {
            String primary = readFile(dest, cap);
            if (primary != null && !primary.isEmpty()) return primary;
        } else if (dir != null) {
            String pending = readFile(new File(dir, dest.getName() + ".tmp"), cap);
            if (pending != null && !pending.isEmpty()) return pending;
        }
        if (dir == null) return "";
        return readFile(new File(dir, dest.getName() + ".bak"), cap);
    }

    private static String readArray() {
        JSONArray copy = new JSONArray();
        for (JSONObject row : events) copy.put(row);
        return copy.toString();
    }

    private static String readFile(File file, int cap) {
        if (file == null || !file.isFile()) return "";
        try (InputStream input = new FileInputStream(file)) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int count;
            int total = 0;
            while ((count = input.read(chunk)) >= 0 && total < cap) {
                buffer.write(chunk, 0, count);
                total += count;
            }
            return buffer.toString(StandardCharsets.UTF_8);
        } catch (Exception error) {
            return "";
        }
    }
}
