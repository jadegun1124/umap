package kr.co.umap.tracker;

import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.app.AlarmManager;
import android.os.BatteryManager;
import android.os.Build;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Background location publisher. Started only after the user turns on the
 * in-app keep-alive control. LocationKeepProcess is a location foreground
 * service so GPS continues after the UI is closed or swiped away.
 * LocationManager GPS_PROVIDER is the high-accuracy stream (the same role as
 * FusedLocationProvider PRIORITY_HIGH_ACCURACY). Network is only the fallback
 * when GPS is off.
 *
 * Verified on 1.54 before this change: a stay asked GPS at 30s, then 60s,
 * and still 60s after 7 minutes, with a 120s ceiling that the normal path
 * did not use. The 2 minute gap was PUBLISH_STILL_MS, the family upload,
 * not the GPS period. The 7 minute constant only selected that same 60s tier.
 *
 * A walk requests GPS every 2s once the step is clear and switches on the
 * detecting fix. A bike or vehicle (about 7 km/h) requests every 1s. A stay
 * asks every 20s and never slower than 30s. Stay fixes are not trail points;
 * the pin stays on the stay anchor. Family uploads are one sealed batch:
 * every 30s while moving, every 60s while still, and immediately when the
 * phone changes between stay and journey. Distance does not trigger an upload.
 * A partial wake lock is held only while the moving stream is on.
 */
public class LocationKeepService {
    public static final String ACTION_FIX = "kr.co.umap.tracker.LOCATION_FIX";
    public static final String ACTION_HEARTBEAT = "kr.co.umap.tracker.LOCATION_HEARTBEAT";
    private static final String PREFS = "umap_location_keep";
    private static final int REQUEST_CODE = OngoingNotificationCleanup.LOCATION_NOTIFICATION_ID;
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();

    public interface Sink {
        void onFix(JSONObject fix);
    }

    private static volatile Context appContext;
    private static volatile Sink sink;
    private static volatile String lastError;
    private static final Object LOCK = new Object();
    private static volatile boolean filterLoaded;
    private static Location stableFix;
    private static Location lastPublished;
    private static long lastPublishedAt;
    /** Walk samples once the step is clear. Denser than the 1.54 2.5s stream. */
    private static final long GPS_MOVING_MS = 2_000L;
    /** Bike and vehicle. Denser than a walk, still above a same-second provider burst. */
    private static final long GPS_RIDE_MS = 1_000L;
    /** First stay check, and every later stay check. No 60s or 120s tier. */
    private static final long GPS_STILL_PROBE_MS = 20_000L;
    /** Confirmed stay. Same 20s, including after 7 minutes. */
    private static final long GPS_STILL_MS = 20_000L;
    /** After 7 minutes still. Does not slow down. */
    private static final long GPS_STILL_LONG_MS = 20_000L;
    /** No stay request is slower than this. */
    private static final long GPS_STILL_MAX_MS = 30_000L;
    private static final long STILL_LONG_AFTER_MS = 7 * 60_000L;
    /**
     * Not a clear walk and not a quiet stay. Faster than the stay check,
     * slower than 2.5s. Inside the 15–30s bridge.
     */
    private static final long GPS_AMBIGUOUS_MS = 15_000L;
    /** Hold 2.5s through a short light. A real stop is most of a minute. */
    private static final long MOVING_HOLD_MS = 45_000L;
    /** A shorter step than 1.51, so a still probe can arm 2.5s on this fix. */
    private static final float WALK_DISPLACE_M = 8f;
    private static final long WALK_DISPLACE_MS = 2_000L;
    /** A 30s, 60s, or 120s stay probe can still be the step that arms the walk. */
    private static final long WALK_PACE_MAX_MS = 120_000L;
    private static final float WALK_IMPLIED_MIN_MPS = 0.6f;
    /** 7 km/h. Same cut as MODE_WALK_MAX_KMH / TRAIL_RIDE_MIN_MPS. */
    private static final float RIDE_MIN_MPS = 7f / 3.6f;
    /** Reported ride speed with this much real movement. Matches TRAIL_RIDE_MIN_STEP_M. */
    private static final float RIDE_STEP_M = 8f;
    /** No speed reading. Matches TRAIL_RIDE_STAY_STEP_M so a courtyard hop does not arm GPS. */
    private static final float RIDE_STAY_STEP_M = 18f;
    /**
     * After a ride, sample faster than the 20s dash hole, slower than 2.5s.
     * Three minutes covers a signal. A longer park returns to 2 minutes, then 5.
     */
    private static final long RIDE_BRIDGE_MS = 15_000L;
    private static final long RIDE_BRIDGE_FOR_MS = 3 * 60_000L;
    /** Drop a second provider's burst. 1s ride fixes and 2.5s walk fixes sit outside this window. */
    private static final long SAMPLE_GAP_MS = 800L;
    /** One sealed family batch. Local emit() is not throttled by these. */
    private static final long UPLOAD_MOVING_MS = 30_000L;
    private static final long UPLOAD_STILL_MS = 60_000L;
    /** Process heartbeat. A fresh beat without a GPS fix is not a healthy keep. */
    private static final long KEEP_HEARTBEAT_FRESH_MS = 90_000L;
    /** Alarm that brings the process back. Inside the 1–5 minute revival window. */
    private static final long WATCHDOG_ALARM_MS = 2 * 60 * 1000L;
    /** No GPS fix while the moving stream is on: drop and re-register providers. */
    private static final long FIX_STALE_MOVING_MS = 15_000L;
    /** No GPS fix while still. Also the banner threshold. */
    private static final long FIX_STALE_STILL_MS = 90_000L;
    private static final int JOURNAL_CAP = 120;
    private static volatile boolean starting = false;
    private static final int HEARTBEAT_CODE = REQUEST_CODE + 1;
    private static long requestedGpsMs = GPS_STILL_PROBE_MS;
    private static long stillSinceMs = 0;
    private static long lastRideAt = 0L;
    private static volatile boolean movingStream = false;
    /** Quiet long enough that the next stay request may widen past the 30s probe. */
    private static boolean stayConfirmed = false;
    /** A hint of movement that has not armed the 2.5s stream. */
    private static boolean ambiguousMotion = false;
    /** The first accepted fix is the stay anchor. Later still probes are not. */
    private static boolean anchorRecorded = false;
    private static boolean updatesRegistered = false;
    private static String registeredConfig = "";
    private static long lastSampleAt = 0;
    private static Location motionAnchor;
    private static Location lastSample;
    private static final JSONArray pendingPoints = new JSONArray();
    private static final JSONArray journal = new JSONArray();
    private static long lastEmittedAt = 0L;

    public static void attach(Context context) {
        appContext = context.getApplicationContext();
    }

    public static void setSink(Sink next) {
        sink = next;
        if (next != null) replayJournal();
    }

    public static boolean isRunning() {
        return isRunning(appContext);
    }

    public static boolean wanted(Context context) {
        Context current = context != null ? context.getApplicationContext() : appContext;
        if (current == null) return false;
        SharedPreferences stored = prefs(current);
        return stored.getBoolean("keepWanted", false) || stored.getBoolean("registered", false);
    }

    public static void noteHeartbeat(Context context) {
        if (context == null) return;
        prefs(context).edit().putLong("heartbeatAt", System.currentTimeMillis()).apply();
    }

    public static long heartbeatAt(Context context) {
        if (context == null) return 0L;
        return prefs(context).getLong("heartbeatAt", 0L);
    }

    public static long lastFixAt(Context context) {
        if (context == null) return 0L;
        return prefs(context).getLong("lastFixAt", 0L);
    }

    /** True when keep is on and the last accepted GPS fix is older than the still watchdog. */
    public static boolean fixStale(Context context) {
        if (context == null || !wanted(context)) return false;
        long last = lastFixAt(context);
        if (last <= 0L) return false;
        return System.currentTimeMillis() - last >= FIX_STALE_STILL_MS;
    }

    /**
     * True when the foreground service is in this process, or its last fix
     * is still inside KEEP_HEARTBEAT_FRESH_MS. A leftover "registered" pref
     * without a fresh beat is not running.
     */
    public static boolean isRunning(Context context) {
        Context current = context != null ? context.getApplicationContext() : appContext;
        if (current == null) return false;
        if (!wanted(current)) return false;
        if (LocationKeepProcess.isAlive()) return true;
        long beat = heartbeatAt(current);
        return beat > 0L && System.currentTimeMillis() - beat < KEEP_HEARTBEAT_FRESH_MS;
    }

    public static String lastError() {
        return lastError;
    }

    public static boolean start(Context context, String configJson) {
        if (starting) return isRunning(context);
        starting = true;
        try {
            return startHolding(context, configJson);
        } finally {
            starting = false;
        }
    }

    private static boolean startHolding(Context context, String configJson) {
        attach(context);
        OngoingNotificationCleanup.clear(context);
        String incoming;
        try {
            incoming = new JSONObject(configJson).toString();
        } catch (Exception error) {
            lastError = "config";
            return false;
        }
        if (!writeConfig(context, configJson)) {
            lastError = "config";
            return false;
        }
        prefs(context).edit().putBoolean("keepWanted", true).commit();
        if (!hasLocationPermission(context)) {
            lastError = "permission";
            disarm(context);
            return false;
        }
        JSONObject config = readConfig(context);
        if (config == null || !allowedBase(config.optString("baseUrl", ""))) {
            lastError = "config";
            disarm(context);
            return false;
        }
        lastError = null;
        String sealKids = sealKidFingerprint(config);
        if (!sealKids.equals(prefs(context).getString("sealKids", ""))) {
            synchronized (LOCK) {
                ensureFilter(context);
                lastPublishedAt = 0L;
                rememberFilter(context);
            }
            prefs(context).edit().putBoolean("registered", true).putString("sealKids", sealKids).commit();
        } else {
            prefs(context).edit().putBoolean("registered", true).commit();
        }
        noteHeartbeat(context);
        KeepAliveWorker.schedule(context);
        synchronized (LOCK) {
            if (!anySharing(config)) {
                removeUpdates(context);
            } else if (updatesRegistered && incoming.equals(registeredConfig)) {
                // 화면이 다시 보여도 같은 위치 유지 설정이면 GNSS를 다시 열지 않는다.
            } else {
                registerUpdates(context, config);
                registeredConfig = incoming;
            }
        }
        if (!anySharing(config)) IO.execute(() -> publish(context, null));
        else scheduleHeartbeat(context);
        LocationKeepProcess.hold(context);
        return true;
    }

    public static void stop(Context context) {
        attach(context);
        prefs(context).edit().remove("config").putBoolean("registered", false).putBoolean("keepWanted", false).commit();
        synchronized (LOCK) {
            clearFilter(context);
            removeUpdates(context);
            cancelHeartbeat(context);
        }
        OngoingNotificationCleanup.clear(context);
        LocationKeepProcess.release(context);
        KeepAliveWorker.cancel(context);
    }

    public static void markUserStopped(Context context) {
        prefs(context).edit().remove("config").putBoolean("registered", false).putBoolean("keepWanted", false).putBoolean("userStopped", true).commit();
        synchronized (LOCK) {
            clearFilter(context);
            removeUpdates(context);
            cancelHeartbeat(context);
        }
        LocationKeepProcess.release(context);
        KeepAliveWorker.cancel(context);
    }

    public static void ackUserStopped(Context context) {
        prefs(context).edit().putBoolean("userStopped", false).apply();
    }

    public static boolean userStopped(Context context) {
        return prefs(context).getBoolean("userStopped", false);
    }

    /** Called every 15s from the foreground service, so a dead GPS listener is not left until the 2 minute alarm. */
    public static void pokeGps(Context context) {
        if (context == null || !wanted(context) || !hasLocationPermission(context)) return;
        long last = lastFixAt(context);
        long quiet = last <= 0L ? Long.MAX_VALUE : System.currentTimeMillis() - last;
        long due = movingStream ? FIX_STALE_MOVING_MS : FIX_STALE_STILL_MS;
        if (quiet < due) return;
        JSONObject config = readConfig(context);
        if (config == null || !anySharing(config)) return;
        synchronized (LOCK) {
            registerUpdates(context, config, true);
        }
    }

    /** Re-register GPS after the foreground service is up. A background registration can be dropped. */
    public static void ensureRunning(Context context) {
        if (context == null || !wanted(context) || !hasLocationPermission(context)) return;
        JSONObject config = readConfig(context);
        if (config == null || !anySharing(config)) return;
        synchronized (LOCK) {
            registerUpdates(context, config);
        }
        scheduleHeartbeat(context);
    }

    /** Boot and an APK update drop the LocationManager registration. The saved config starts it again. */
    public static void restartIfWanted(Context context) {
        if (context == null) return;
        attach(context);
        if (userStopped(context)) return;
        boolean wanted = prefs(context).getBoolean("keepWanted", false) || prefs(context).getBoolean("registered", false);
        if (!wanted) return;
        JSONObject config = readConfig(context);
        if (config == null) return;
        start(context, config.toString());
    }

    @SuppressWarnings("deprecation")
    public static Location locationFrom(Intent intent) {
        if (intent == null) return null;
        if (Build.VERSION.SDK_INT >= 33) {
            return intent.getParcelableExtra(LocationManager.KEY_LOCATION_CHANGED, Location.class);
        }
        return intent.getParcelableExtra(LocationManager.KEY_LOCATION_CHANGED);
    }

    public static void onFix(Context context, Location location, BroadcastReceiver.PendingResult pending) {
        attach(context);
        IO.execute(() -> {
        try {
            if (!prefs(context).getBoolean("registered", false) || location == null) return;
            if (!hasLocationPermission(context)) {
                disarm(context);
                return;
            }
            Upload upload;
            synchronized (LOCK) {
                upload = handleFix(context, location);
            }
            if (upload != null) {
                int posted = publish(context, upload);
                if (posted >= 0) {
                    synchronized (LOCK) {
                        commitUpload(context, upload, posted == 1);
                    }
                }
            }
        } finally {
                if (pending != null) pending.finish();
            }
        });
    }

    private static void disarm(Context context) {
        prefs(context).edit().putBoolean("registered", false).commit();
        synchronized (LOCK) {
            removeUpdates(context);
            cancelHeartbeat(context);
        }
        LocationKeepProcess.setMovingWake(context, false);
        LocationKeepProcess.release(context);
        KeepAliveWorker.cancel(context);
    }

    public static void onHeartbeat(Context context, BroadcastReceiver.PendingResult pending) {
        attach(context);
        IO.execute(() -> {
            try {
                if (!prefs(context).getBoolean("registered", false)) return;
                Location last;
                boolean movingNow;
                synchronized (LOCK) {
                    ensureFilter(context);
                    long quiet = lastFixAt(context) <= 0L ? Long.MAX_VALUE : System.currentTimeMillis() - lastFixAt(context);
                    long due = movingStream ? FIX_STALE_MOVING_MS : FIX_STALE_STILL_MS;
                    JSONObject config = readConfig(context);
                    boolean granted = hasLocationPermission(context);
                    if (!LocationKeepProcess.isAlive()) {
                        LocationKeepProcess.hold(context);
                    }
                    if (granted && quiet >= due && anySharing(config)) {
                        registerUpdates(context, config, true);
                    }
                    last = lastPublished == null ? null : new Location(lastPublished);
                    movingNow = movingStream;
                }
                noteHeartbeat(context);
                if (last != null && anySharing(readConfig(context))) {
                    long since = lastPublishedAt <= 0L ? Long.MAX_VALUE : System.currentTimeMillis() - lastPublishedAt;
                    long gap = movingNow ? UPLOAD_MOVING_MS : UPLOAD_STILL_MS;
                    if (since >= gap) {
                        Upload upload = new Upload();
                        upload.pin = last;
                        upload.moving = movingNow;
                        upload.flush = false;
                        upload.at = System.currentTimeMillis();
                        upload.sent = 0;
                        int posted = publish(context, upload);
                        if (posted >= 0) {
                            synchronized (LOCK) {
                                lastPublishedAt = upload.at;
                                rememberFilter(context);
                            }
                        }
                    }
                }
            } finally {
                scheduleHeartbeat(context);
                if (pending != null) pending.finish();
            }
        });
    }

    private static android.app.PendingIntent heartbeatIntent(Context context) {
        Intent intent = new Intent(context, LocationKeepReceiver.class);
        intent.setAction(ACTION_HEARTBEAT);
        int flags = android.app.PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 31) flags |= android.app.PendingIntent.FLAG_IMMUTABLE;
        return android.app.PendingIntent.getBroadcast(context, HEARTBEAT_CODE, intent, flags);
    }

    /** Alarm that wakes the process when GPS has gone quiet. */
    public static void ensureWatchdog(Context context) {
        scheduleHeartbeat(context);
    }

    public static void scheduleRevive(Context context) {
        if (context == null || !wanted(context)) return;
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        long when = System.currentTimeMillis() + 5_000L;
        try {
            scheduleAlarm(alarms, when, heartbeatIntent(context));
        } catch (Exception ignored) {
            /* The periodic watchdog is the next chance. */
        }
    }

    private static void scheduleHeartbeat(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null || !prefs(context).getBoolean("registered", false)) return;
        try {
            scheduleAlarm(alarms, System.currentTimeMillis() + WATCHDOG_ALARM_MS, heartbeatIntent(context));
        } catch (Exception ignored) {
            /* 다음 위치 콜백이 심박을 다시 건다 */
        }
    }

    private static void scheduleAlarm(AlarmManager alarms, long when, android.app.PendingIntent intent) {
        if (Build.VERSION.SDK_INT >= 31 && !alarms.canScheduleExactAlarms()) {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, intent);
            return;
        }
        if (Build.VERSION.SDK_INT >= 23) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, intent);
            return;
        }
        alarms.set(AlarmManager.RTC_WAKEUP, when, intent);
    }

    private static void cancelHeartbeat(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        try {
            alarms.cancel(heartbeatIntent(context));
        } catch (Exception ignored) {
            /* 이미 없는 알람 */
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static boolean writeConfig(Context context, String configJson) {
        try {
            JSONObject parsed = new JSONObject(configJson);
            if (!allowedBase(parsed.optString("baseUrl", ""))) return false;
            if (!parsed.has("targets")) return false;
            prefs(context).edit().putString("config", parsed.toString()).putBoolean("userStopped", false).commit();
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    private static JSONObject readConfig(Context context) {
        String raw = prefs(context).getString("config", "");
        if (raw == null || raw.isEmpty()) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception error) {
            return null;
        }
    }

    private static boolean allowedBase(String base) {
        try {
            Uri uri = Uri.parse(base);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (host == null || uri.getUserInfo() != null) return false;
            if ("https".equalsIgnoreCase(scheme)) return true;
            return "http".equalsIgnoreCase(scheme) && ("localhost".equals(host) || "127.0.0.1".equals(host));
        } catch (Exception error) {
            return false;
        }
    }

    private static android.app.PendingIntent locationIntent(Context context) {
        Intent intent = new Intent(context, LocationKeepReceiver.class);
        intent.setAction(ACTION_FIX);
        int flags = android.app.PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 31) flags |= android.app.PendingIntent.FLAG_MUTABLE;
        return android.app.PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags);
    }

    @SuppressLint("MissingPermission")
    private static void registerUpdates(Context context, JSONObject config) {
        registerUpdates(context, config, false);
    }

    @SuppressLint("MissingPermission")
    private static void registerUpdates(Context context, JSONObject config, boolean withNetwork) {
        LocationManager locationManager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) return;
        android.app.PendingIntent pending = locationIntent(context);
        try {
            locationManager.removeUpdates(pending);
        } catch (Exception ignored) {
            /* 이미 해제된 감시 */
        }
        boolean precise = config.optBoolean("precise", true);
        long gpsMs = requestedGpsMs < GPS_RIDE_MS ? GPS_RIDE_MS : requestedGpsMs;
        boolean gpsOn = false;
        try {
            if (precise && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, gpsMs, 0f, pending);
                gpsOn = true;
            }
        } catch (Exception ignored) {
            /* GPS 하드웨어가 없거나 권한이 없는 경우 */
        }
        if (!gpsOn || withNetwork) {
            long networkMs = movingStream ? gpsMs : Math.max(gpsMs, GPS_STILL_PROBE_MS);
            try {
                if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                    locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, networkMs, 0f, pending);
                }
            } catch (Exception ignored) {
                /* 네트워크 위치가 없는 기기 */
            }
        }
        updatesRegistered = true;
    }

    private static void removeUpdates(Context context) {
        updatesRegistered = false;
        registeredConfig = "";
        LocationManager locationManager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) return;
        try {
            locationManager.removeUpdates(locationIntent(context));
        } catch (Exception ignored) {
            /* 이미 해제된 감시 */
        }
    }

    private static boolean hasLocationPermission(Context context) {
        return context.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || context.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private static boolean anySharing(JSONObject config) {
        for (JSONObject target : targets(config)) {
            if (target.optBoolean("sharing", false)) return true;
        }
        return false;
    }

    private static List<JSONObject> targets(JSONObject config) {
        List<JSONObject> list = new ArrayList<>();
        if (config == null) return list;
        JSONArray raw = config.optJSONArray("targets");
        if (raw == null) return list;
        for (int index = 0; index < raw.length() && index < 5; index += 1) {
            JSONObject target = raw.optJSONObject(index);
            if (target == null) continue;
            String token = target.optString("token", "");
            String code = target.optString("code", "");
            if (!token.matches("[A-Za-z0-9_-]{16,64}\\.[A-Za-z0-9_-]{16,64}")) continue;
            if (!code.matches("\\d{4,6}")) continue;
            list.add(target);
        }
        return list;
    }

    private static void ensureFilter(Context context) {
        if (filterLoaded) return;
        filterLoaded = true;
        SharedPreferences stored = prefs(context);
        stableFix = readStoredFix(stored, "stable");
        lastPublished = readStoredFix(stored, "last");
        lastPublishedAt = stored.getLong("lastAt", 0L);
    }

    private static void rememberFilter(Context context) {
        SharedPreferences.Editor editor = prefs(context).edit();
        writeStoredFix(editor, "stable", stableFix);
        writeStoredFix(editor, "last", lastPublished);
        editor.putLong("lastAt", lastPublishedAt);
        editor.apply();
    }

    private static void clearFilter(Context context) {
        stableFix = null;
        lastPublished = null;
        lastPublishedAt = 0L;
        requestedGpsMs = GPS_STILL_PROBE_MS;
        stillSinceMs = 0L;
        lastRideAt = 0L;
        movingStream = false;
        stayConfirmed = false;
        ambiguousMotion = false;
        anchorRecorded = false;
        lastSampleAt = 0L;
        motionAnchor = null;
        lastSample = null;
        lastEmittedAt = 0L;
        while (pendingPoints.length() > 0) pendingPoints.remove(0);
        while (journal.length() > 0) journal.remove(0);
        filterLoaded = true;
        prefs(context).edit()
            .remove("stable").remove("last").remove("lastAt").remove("heartbeatAt").remove("lastFixAt")
            .remove("beatLatE6").remove("beatLngE6").remove("beatAcc")
            .apply();
    }

    private static Location readStoredFix(SharedPreferences stored, String key) {
        String raw = stored.getString(key, "");
        if (raw == null || raw.isEmpty()) return null;
        if (raw.startsWith("umap-device-seal:")) raw = DeviceCipher.open(raw);
        if (raw == null || raw.isEmpty()) return null;
        try {
            JSONObject json = new JSONObject(raw);
            Location location = new Location(json.optString("provider", LocationManager.GPS_PROVIDER));
            location.setLatitude(json.getDouble("lat"));
            location.setLongitude(json.getDouble("lng"));
            location.setTime(json.optLong("time", 0L));
            location.setAccuracy((float) json.optDouble("acc", 0d));
            if (json.has("speed") && !json.isNull("speed")) location.setSpeed((float) json.getDouble("speed"));
            return location;
        } catch (Exception error) {
            return null;
        }
    }

    private static void writeStoredFix(SharedPreferences.Editor editor, String key, Location location) {
        if (location == null) {
            editor.remove(key);
            return;
        }
        try {
            JSONObject json = new JSONObject();
            json.put("provider", location.getProvider() == null ? LocationManager.GPS_PROVIDER : location.getProvider());
            json.put("lat", location.getLatitude());
            json.put("lng", location.getLongitude());
            json.put("time", location.getTime());
            json.put("acc", location.getAccuracy());
            if (location.hasSpeed()) json.put("speed", location.getSpeed());
            String sealed = DeviceCipher.seal(json.toString());
            if (sealed.isEmpty()) editor.remove(key);
            else editor.putString(key, sealed);
        } catch (Exception error) {
            editor.remove(key);
        }
    }

    private static final class Upload {
        Location pin;
        JSONArray trail;
        boolean flush;
        boolean moving;
        long at;
        int sent;
    }

    private static Upload handleFix(Context context, Location location) {
        ensureFilter(context);
        JSONObject config = readConfig(context);
        if (config == null) return null;
        long now = System.currentTimeMillis();
        long fixAt = location.getTime() > 0 ? location.getTime() : now;
        if (now - fixAt > 30_000 || fixAt > now + 10_000) return null;
        boolean precise = config.optBoolean("precise", true);
        float accuracy = location.getAccuracy();
        if (accuracy <= 0f) return null;
        boolean freshPrecise = stableFix != null && now - stableFix.getTime() < 20_000L;
        if (precise && accuracy > 80f && (freshPrecise || accuracy > 400f)) return null;
        if (!precise && accuracy > 400f) return null;
        if (stableFix != null) {
            long dt = fixAt - stableFix.getTime();
            if (dt < 0) return null;
            if (dt > 0 && dt <= 180_000) {
                float speed = stableFix.distanceTo(location) / (dt / 1000f);
                if (speed > 350f) return null;
            }
        }
        stableFix = new Location(location);
        if (stableFix.getTime() <= 0) stableFix.setTime(fixAt);
        if (lastSample != null && lastSampleAt > 0) {
            long sinceSample = now - lastSampleAt;
            float jumped = lastSample.distanceTo(location);
            boolean relocation = jumped > stayGate(lastSample, location);
            float implied = sinceSample > 0 ? jumped / (sinceSample / 1000f) : 0f;
            boolean rideSample = implied >= RIDE_MIN_MPS && jumped >= RIDE_STEP_M && sinceSample >= 800L;
            if (sinceSample >= 0 && sinceSample < SAMPLE_GAP_MS && !relocation && !rideSample) {
                rememberFilter(context);
                return null;
            }
        }
        boolean wasMoving = movingStream;
        boolean moving = noteMovement(location, fixAt);
        boolean stateChanged = wasMoving != moving;
        long want = gpsInterval(moving, now);
        if (want != requestedGpsMs) {
            requestedGpsMs = want;
            registerUpdates(context, config);
        }
        lastSample = new Location(location);
        lastSampleAt = now;
        prefs(context).edit().putLong("lastFixAt", now).apply();
        noteHeartbeat(context);
        LocationKeepProcess.setMovingWake(context, movingStream);
        boolean record = recordFix(moving);
        if (record) rememberPoint(location, fixAt);
        long gap = moving ? UPLOAD_MOVING_MS : UPLOAD_STILL_MS;
        boolean due = lastPublishedAt <= 0L || now - lastPublishedAt >= gap;
        if (!stateChanged && !due) {
            rememberFilter(context);
            scheduleHeartbeat(context);
            return null;
        }
        Upload upload = new Upload();
        upload.pin = !moving && motionAnchor != null ? new Location(motionAnchor) : new Location(location);
        upload.moving = moving;
        upload.flush = stateChanged;
        upload.at = now;
        upload.trail = copyPending();
        upload.sent = upload.trail.length();
        rememberFilter(context);
        scheduleHeartbeat(context);
        return upload;
    }

    private static void commitUpload(Context context, Upload upload, boolean dropPending) {
        if (dropPending) {
            for (int index = 0; index < upload.sent && pendingPoints.length() > 0; index += 1) {
                pendingPoints.remove(0);
            }
        }
        if (upload.pin != null) lastPublished = new Location(upload.pin);
        lastPublishedAt = upload.at;
        rememberFilter(context);
    }

    private static void rememberPoint(Location location, long fixAt) {
        try {
            JSONObject point = new JSONObject();
            point.put("lat", location.getLatitude());
            point.put("lng", location.getLongitude());
            point.put("at", fixAt);
            point.put("accuracyM", Math.round(Math.max(0f, location.getAccuracy())));
            if (location.hasSpeed() && location.getSpeed() >= 0f && location.getSpeed() < 400f) {
                point.put("speedMps", location.getSpeed());
            }
            pendingPoints.put(point);
            journal.put(new JSONObject(point.toString()));
            while (pendingPoints.length() > JOURNAL_CAP) pendingPoints.remove(0);
            while (journal.length() > JOURNAL_CAP) journal.remove(0);
            if (sink != null) {
                emit(location, fixAt);
                lastEmittedAt = fixAt;
            }
        } catch (Exception ignored) {
            /* The next fix tries again. */
        }
    }

    private static JSONArray copyPending() {
        JSONArray copy = new JSONArray();
        for (int index = 0; index < pendingPoints.length(); index += 1) {
            JSONObject point = pendingPoints.optJSONObject(index);
            if (point != null) copy.put(point);
        }
        return copy;
    }

    private static void replayJournal() {
        Sink current = sink;
        if (current == null) return;
        for (int index = 0; index < journal.length(); index += 1) {
            JSONObject point = journal.optJSONObject(index);
            if (point == null || point.optLong("at") <= lastEmittedAt) continue;
            try {
                JSONObject fix = new JSONObject();
                fix.put("lat", point.getDouble("lat"));
                fix.put("lng", point.getDouble("lng"));
                fix.put("accuracyM", point.optInt("accuracyM"));
                if (point.has("speedMps")) fix.put("speedMps", point.getDouble("speedMps"));
                else fix.put("speedMps", JSONObject.NULL);
                fix.put("at", point.getLong("at"));
                fix.put("provider", "gps");
                current.onFix(fix);
                lastEmittedAt = point.getLong("at");
            } catch (Exception ignored) {
                /* Skip a damaged journal row. */
            }
        }
    }

    /**
     * Same stay bubble as staySnapGate in src/lib/tracking.mjs.
     * Used only to tell a real relocation from a second fix in the same second.
     * The latitude sent onward is the GPS fix. JS holds the pin inside the bubble.
     */
    private static float stayGate(Location anchor, Location next) {
        float anchorAccuracy = anchor == null ? 0f : Math.max(0f, anchor.getAccuracy());
        float nextAccuracy = next == null ? 0f : Math.max(0f, next.getAccuracy());
        return Math.max(50f, Math.max(anchorAccuracy, nextAccuracy) * 2f);
    }

    /**
     * True only while the 2s or 1s stream should stay on.
     * A still probe that has actually walked arms that stream on this fix.
     */
    private static boolean noteMovement(Location fix, long fixAt) {
        float speed = fix.hasSpeed() ? fix.getSpeed() : -1f;
        if (motionAnchor == null) {
            motionAnchor = new Location(fix);
            motionAnchor.setTime(fixAt);
            stillSinceMs = fixAt;
            stayConfirmed = false;
            ambiguousMotion = false;
            float opening = fix.hasSpeed() ? fix.getSpeed() : -1f;
            // Already at about 30 km/h: start the 1s stream on this fix so the
            // drive does not wait out a stay probe before the next sample.
            if (opening >= 8f) {
                lastRideAt = fixAt;
                stillSinceMs = 0L;
                movingStream = true;
                return true;
            }
            movingStream = false;
            return false;
        }
        long anchorAt = motionAnchor.getTime() > 0 ? motionAnchor.getTime() : fixAt;
        long dt = fixAt - anchorAt;
        if (dt < 0) dt = 0;
        float moved = motionAnchor.distanceTo(fix);
        float implied = dt > 0 ? moved / (dt / 1000f) : 0f;
        boolean pacedWalk = dt >= WALK_DISPLACE_MS && dt <= WALK_PACE_MAX_MS && moved >= WALK_DISPLACE_M && implied >= WALK_IMPLIED_MIN_MPS && implied <= 12f;
        boolean pacedTrip = dt > WALK_PACE_MAX_MS && moved >= WALK_DISPLACE_M && implied >= WALK_IMPLIED_MIN_MPS && implied <= 45f;
        boolean reported = speed >= WALK_IMPLIED_MIN_MPS && moved >= 5f && implied >= 0.45f && dt >= WALK_DISPLACE_MS && dt <= WALK_PACE_MAX_MS;
        // Above a walk, a car used to stay on the slow request and the trail
        // became one chord. A reported ride, or a fast gap with no speed, arms 1s.
        boolean rideReported = speed >= RIDE_MIN_MPS && moved >= RIDE_STEP_M && dt >= 1_000L && dt <= 30_000L && implied >= RIDE_MIN_MPS * 0.45f;
        boolean rideImplied = speed < 0f && dt >= 2_500L && dt <= 180_000L && moved >= RIDE_STAY_STEP_M && implied > 2.4f && implied <= 45f;
        if (pacedWalk || pacedTrip || reported || rideReported || rideImplied) {
            if (speed >= RIDE_MIN_MPS || implied >= RIDE_MIN_MPS) lastRideAt = fixAt;
            motionAnchor = new Location(fix);
            motionAnchor.setTime(fixAt);
            stillSinceMs = 0L;
            stayConfirmed = false;
            ambiguousMotion = false;
            movingStream = true;
            return true;
        }
        // A parked phone often reports a walking speed with almost no movement.
        // That badge must not hold the 20s bridge after the stay is confirmed.
        boolean quiet = moved < 4f;
        boolean partial = moved >= 4f && moved < WALK_DISPLACE_M;
        if (!movingStream) {
            if (stillSinceMs == 0L) stillSinceMs = anchorAt;
            if (quiet && dt >= GPS_STILL_PROBE_MS) stayConfirmed = true;
            ambiguousMotion = partial && !stayConfirmed;
            if (dt >= MOVING_HOLD_MS && moved < WALK_DISPLACE_M) {
                motionAnchor = new Location(fix);
                motionAnchor.setTime(fixAt);
            }
            return false;
        }
        boolean littleDrift = moved < WALK_DISPLACE_M && dt >= MOVING_HOLD_MS;
        boolean settled = moved <= stayGate(motionAnchor, fix) && dt >= MOVING_HOLD_MS && (speed < 0f || speed < 0.7f);
        if (littleDrift || settled) {
            if (stillSinceMs == 0L) stillSinceMs = anchorAt;
            movingStream = false;
            stayConfirmed = false;
            ambiguousMotion = false;
            motionAnchor = new Location(fix);
            motionAnchor.setTime(fixAt);
            return false;
        }
        ambiguousMotion = false;
        return true;
    }

    /** The opening fix is stored. A later stay probe is not a trail point. */
    private static boolean recordFix(boolean moving) {
        if (!anchorRecorded) {
            anchorRecorded = true;
            return true;
        }
        return moving;
    }

    private static long gpsInterval(boolean moving, long now) {
        if (moving) {
            if (lastRideAt > 0L && now - lastRideAt <= MOVING_HOLD_MS) return GPS_RIDE_MS;
            return GPS_MOVING_MS;
        }
        if (lastRideAt > 0L && now - lastRideAt < RIDE_BRIDGE_FOR_MS) return RIDE_BRIDGE_MS;
        if (ambiguousMotion && !stayConfirmed) return GPS_AMBIGUOUS_MS;
        long stillFor = stillSinceMs > 0L ? Math.max(0L, now - stillSinceMs) : 0L;
        long interval = GPS_STILL_PROBE_MS;
        if (stayConfirmed && stillFor >= STILL_LONG_AFTER_MS) interval = GPS_STILL_LONG_MS;
        else if (stayConfirmed) interval = GPS_STILL_MS;
        if (interval > GPS_STILL_MAX_MS) interval = GPS_STILL_MAX_MS;
        return interval;
    }

    private static void emit(Location location, long fixAt) {
        Sink current = sink;
        if (current == null) return;
        try {
            JSONObject fix = new JSONObject();
            fix.put("lat", location.getLatitude());
            fix.put("lng", location.getLongitude());
            fix.put("accuracyM", Math.round(location.getAccuracy()));
            if (location.hasSpeed() && location.getSpeed() >= 0f && location.getSpeed() < 400f) fix.put("speedMps", location.getSpeed());
            else fix.put("speedMps", JSONObject.NULL);
            fix.put("at", fixAt);
            String provider = location.getProvider();
            fix.put("provider", provider == null ? "" : provider);
            current.onFix(fix);
        } catch (Exception ignored) {
            /* 화면 브리지가 없어도 서버 전송은 계속한다 */
        }
    }

    /** 1 when every sealed target accepted the batch, 0 when the clock should move but points stay, -1 when nothing was attempted. */
    private static int publish(Context context, Upload upload) {
        Location location = upload == null ? null : upload.pin;
        return publishBody(context, location, upload);
    }

    private static int publishBody(Context context, Location location, Upload upload) {
        JSONObject current = readConfig(context);
        if (current == null) return location == null ? 0 : -1;
        String base = current.optString("baseUrl", "").replaceAll("/+$", "");
        String name = current.optString("name", "가족").trim();
        if (name.isEmpty()) name = "가족";
        if (name.length() > 80) name = name.substring(0, 80);
        String memberId = current.optString("memberId", "");
        String profileKey = current.optString("profileKey", "");
        boolean identified = memberId.matches("local-[a-z0-9]{3,64}") && profileKey.matches("[A-Za-z0-9_\\-]{16,64}");
        long at = System.currentTimeMillis();
        int battery = batteryPct(context);
        boolean charging = chargingNow(context);
        if (!prefs(context).getBoolean("registered", false)) return -1;
        boolean changed = false;
        boolean wantedShare = false;
        boolean heldBack = false;
        for (JSONObject target : targets(current)) {
            boolean sharing = target.optBoolean("sharing", false);
            if (sharing && location == null) continue;
            if (!sharing && target.optBoolean("revokeSent", false)) continue;
            try {
                JSONObject body = new JSONObject();
                body.put("code", target.optString("code"));
                body.put("name", name);
                if (identified) body.put("memberId", memberId);
                body.put("sharing", sharing);
                body.put("at", at);
                body.put("accuracyM", location == null ? 0 : Math.round(Math.max(0f, location.getAccuracy())));
                if ("family".equals(target.optString("audience"))) body.put("audience", "family");
                if (!sharing || location == null) {
                    body.put("lat", JSONObject.NULL);
                    body.put("lng", JSONObject.NULL);
                } else {
                    JSONObject seals = current.optJSONObject("seals");
                    JSONObject sealInfo = seals == null ? null : seals.optJSONObject(target.optString("code"));
                    JSONObject secret = new JSONObject();
                    secret.put("lat", location.getLatitude());
                    secret.put("lng", location.getLongitude());
                    secret.put("accuracyM", Math.round(Math.max(0f, location.getAccuracy())));
                    JSONObject envelope = sealInfo == null ? null : sealCoordinates(sealInfo.optString("key"), sealInfo.optString("kid"), secret.toString());
                    wantedShare = true;
                    if (envelope == null) {
                        heldBack = true;
                        continue;
                    }
                    body.put("lat", JSONObject.NULL);
                    body.put("lng", JSONObject.NULL);
                    body.put("accuracyM", 0);
                    body.put("seal", envelope);
                    if (battery >= 0) body.put("batteryPct", battery);
                    body.put("charging", charging);
                    body.put("moving", upload != null && upload.moving);
                    if (upload != null && upload.flush) body.put("flush", true);
                    JSONObject trail = upload == null ? null : sealTrail(sealInfo, upload.trail);
                    if (upload != null && upload.trail != null && upload.trail.length() > 0 && trail == null) {
                        heldBack = true;
                        continue;
                    }
                    if (trail != null) body.put("trail", trail);
                }
                boolean posted = putWithRetry(base, target.optString("token"), body, identified ? profileKey : "");
                if (posted) {
                    target.put("revokeSent", !sharing);
                    changed = true;
                } else if (sharing && location != null) {
                    heldBack = true;
                }
            } catch (Exception ignored) {
                if (sharing && location != null) heldBack = true;
            }
        }
        if (changed) prefs(context).edit().putString("config", current.toString()).apply();
        if (!wantedShare) return 0;
        return heldBack ? 0 : 1;
    }

    private static String sealKidFingerprint(JSONObject config) {
        JSONObject seals = config == null ? null : config.optJSONObject("seals");
        if (seals == null) return "";
        List<String> parts = new ArrayList<>();
        java.util.Iterator<String> keys = seals.keys();
        while (keys.hasNext()) {
            String code = keys.next();
            JSONObject info = seals.optJSONObject(code);
            parts.add(code + "=" + (info == null ? "" : info.optString("kid", "")));
        }
        java.util.Collections.sort(parts);
        StringBuilder joined = new StringBuilder();
        for (String part : parts) {
            if (joined.length() > 0) joined.append(',');
            joined.append(part);
        }
        return joined.toString();
    }

    /** Same envelope as src/lib/familySeal.mjs sealJson. Without a family key the fix is not uploaded. */
    private static JSONObject sealCoordinates(String keyB64, String kid, String plaintext) {
        if (keyB64 == null || kid == null || kid.length() < 16 || kid.length() > 64) return null;
        try {
            byte[] key = Base64.decode(keyB64, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
            if (key.length != 32) return null;
            byte[] iv = new byte[12];
            new SecureRandom().nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
            byte[] ct = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            JSONObject envelope = new JSONObject();
            envelope.put("v", 1);
            envelope.put("alg", "A256GCM");
            envelope.put("kid", kid);
            envelope.put("iv", Base64.encodeToString(iv, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP));
            envelope.put("ct", Base64.encodeToString(ct, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP));
            return envelope;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static JSONObject sealTrail(JSONObject sealInfo, JSONArray points) {
        if (sealInfo == null || points == null || points.length() == 0) return null;
        try {
            JSONObject secret = new JSONObject();
            secret.put("points", points);
            secret.put("journeys", new JSONArray());
            return sealCoordinates(sealInfo.optString("key"), sealInfo.optString("kid"), secret.toString());
        } catch (Exception ignored) {
            return null;
        }
    }

    private static boolean putWithRetry(String base, String token, JSONObject body, String profileKey) {
        for (int attempt = 0; attempt < 3; attempt += 1) {
            if (put(base, token, body, profileKey)) return true;
            try {
                Thread.sleep(1_500L * (attempt + 1));
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return false;
    }

    private static String readStream(InputStream stream) throws Exception {
        if (stream == null) return "";
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[256];
        int count;
        int total = 0;
        while ((count = stream.read(chunk)) >= 0 && total < 4096) {
            buffer.write(chunk, 0, count);
            total += count;
        }
        return buffer.toString(StandardCharsets.UTF_8);
    }

    private static boolean put(String base, String token, JSONObject body, String profileKey) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(base + "/v1/rooms/" + body.getString("code") + "/place");
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setRequestMethod("PUT");
            connection.setRequestProperty("content-type", "application/json; charset=utf-8");
            connection.setRequestProperty("x-umap-sync-key", token);
            if (profileKey != null && !profileKey.isEmpty()) connection.setRequestProperty("x-umap-profile-key", profileKey);
            connection.setDoOutput(true);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream stream = connection.getOutputStream()) {
                stream.write(bytes);
            }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) return false;
            String response = "";
            try {
                response = readStream(connection.getInputStream());
            } catch (Exception ignored) {
                response = "";
            }
            return !response.contains("\"collected\":false");
        } catch (Exception error) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static int batteryPct(Context context) {
        Intent sticky = stickyBattery(context);
        if (sticky == null) return -1;
        int level = sticky.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = sticky.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        if (level < 0 || scale <= 0) return -1;
        return Math.round(level * 100f / scale);
    }

    private static boolean chargingNow(Context context) {
        Intent sticky = stickyBattery(context);
        if (sticky == null) return false;
        int status = sticky.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        return status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL;
    }

    private static Intent stickyBattery(Context context) {
        try {
            return context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        } catch (Exception error) {
            return null;
        }
    }
}
