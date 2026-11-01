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
 * in-app keep-alive control. Registers LocationManager updates with a
 * PendingIntent so the process does not need a foreground service.
 *
 * Android 12 and later always show a foreground-service notification, even
 * when the channel importance is minimum and the title is empty. That is the
 * blank Umap row 1.6.0 left in the shade. This class does not post one and
 * does not create a location channel.
 *
 * Updates keep the requested interval while the app is in the foreground or
 * on the battery-optimization allowlist (배터리 제한 없음) with 항상 허용.
 * Without that allowlist, Android 8+ may throttle a background app to a few
 * fixes an hour. The system location-in-use glyph is not an app notification.
 *
 * Thresholds match src/lib/tracking.mjs: drop fixes older than 30s and jumps
 * faster than 350 m/s. A precise fix above 80m is kept when the last good
 * fix is already 20s old, up to 400m, so a network fallback can leave a
 * stale pin. A fresh precise fix still wins over a coarser one.
 * Coordinates are the real fix. The live pin's stay bubble is applied in JS.
 * Keep-alive is not a continuous GNSS stream. A walk requests GPS every
 * 2.5s once the step is clear (about 12m at walking pace, or a reported speed
 * with real displacement). A bike or vehicle (about 7 km/h, 8m when speed is
 * reported, 18m when it is not) requests every 1s so the line stays dense.
 * A short light does not drop
 * a walk: the stream stays dense until the phone has barely moved for 45s.
 * After a ride, a stop holds 12s fixes for 3 minutes so the next departure is
 * not a 20s hole. It does not stay at 2.5s while parked. A confirmed stay is
 * then 2 minutes, and 5 minutes after 7 minutes still — the same moment a
 * journey card is archived. The first request, and every fresh process,
 * starts at 2 minutes. Family HTTP is separate: at most every 8s or 25m while
 * moving, and every 2 minutes while still. The local trail still receives
 * every accepted fix.
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
    /** Walk samples once the step is clear. */
    private static final long GPS_MOVING_MS = 2_500L;
    /** Bike and vehicle. Denser than a walk, still above a same-second provider burst. */
    private static final long GPS_RIDE_MS = 1_000L;
    /** Confirmed stay, and the interval keep-alive uses before a walk is clear. */
    private static final long GPS_STILL_MS = 120_000L;
    /** After 7 minutes still, matching JOURNEY_STAY_MS. */
    private static final long GPS_STILL_LONG_MS = 300_000L;
    private static final long STILL_LONG_AFTER_MS = 7 * 60_000L;
    /** Hold 2.5s through a short light. A real stop is most of a minute. */
    private static final long MOVING_HOLD_MS = 45_000L;
    private static final float WALK_DISPLACE_M = 12f;
    private static final long WALK_DISPLACE_MS = 4_000L;
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
    private static final long RIDE_BRIDGE_MS = 12_000L;
    private static final long RIDE_BRIDGE_FOR_MS = 3 * 60_000L;
    /** Drop a second provider's burst. 2.5s GPS fixes sit outside this window. */
    private static final long SAMPLE_GAP_MS = 1_200L;
    /** Family server. Local emit() is not throttled by these. */
    private static final long PUBLISH_MOVING_MS = 8_000L;
    private static final long PUBLISH_STILL_MS = 120_000L;
    /** Fresher than the 10 minute family stale window, even when GPS is quiet. */
    private static final long HEARTBEAT_MS = 3 * 60 * 1000L;
    private static final int HEARTBEAT_CODE = REQUEST_CODE + 1;
    private static final float PUBLISH_MOVING_M = 25f;
    private static long requestedGpsMs = GPS_STILL_MS;
    private static long stillSinceMs = 0;
    private static long lastRideAt = 0L;
    private static boolean movingStream = false;
    private static boolean updatesRegistered = false;
    private static String registeredConfig = "";
    private static long lastSampleAt = 0;
    private static Location motionAnchor;
    private static Location lastSample;

    public static void attach(Context context) {
        appContext = context.getApplicationContext();
    }

    public static void setSink(Sink next) {
        sink = next;
    }

    public static boolean isRunning() {
        Context context = appContext;
        if (context == null) return false;
        return prefs(context).getBoolean("registered", false);
    }

    public static String lastError() {
        return lastError;
    }

    public static boolean start(Context context, String configJson) {
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
        return true;
    }

    public static void stop(Context context) {
        attach(context);
        prefs(context).edit().remove("config").putBoolean("registered", false).commit();
        synchronized (LOCK) {
            clearFilter(context);
            removeUpdates(context);
            cancelHeartbeat(context);
        }
        OngoingNotificationCleanup.clear(context);
    }

    public static void markUserStopped(Context context) {
        prefs(context).edit().remove("config").putBoolean("registered", false).putBoolean("userStopped", true).commit();
        synchronized (LOCK) {
            clearFilter(context);
            removeUpdates(context);
            cancelHeartbeat(context);
        }
    }

    public static void ackUserStopped(Context context) {
        prefs(context).edit().putBoolean("userStopped", false).apply();
    }

    public static boolean userStopped(Context context) {
        return prefs(context).getBoolean("userStopped", false);
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
            Location publishFix;
            synchronized (LOCK) {
                publishFix = handleFix(context, location);
            }
            if (publishFix != null) publish(context, publishFix);
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
    }

    public static void onHeartbeat(Context context, BroadcastReceiver.PendingResult pending) {
        attach(context);
        IO.execute(() -> {
            try {
                if (!prefs(context).getBoolean("registered", false)) return;
                Location last;
                synchronized (LOCK) {
                    ensureFilter(context);
                    last = lastPublished == null ? null : new Location(lastPublished);
                }
                if (last != null && anySharing(readConfig(context))) publish(context, last);
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

    private static void scheduleHeartbeat(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null || !prefs(context).getBoolean("registered", false)) return;
        try {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + HEARTBEAT_MS, heartbeatIntent(context));
        } catch (Exception ignored) {
            /* 다음 위치 콜백이 심박을 다시 건다 */
        }
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
        if (!gpsOn) {
            long networkMs = Math.max(gpsMs, GPS_STILL_MS);
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
        requestedGpsMs = GPS_STILL_MS;
        stillSinceMs = 0L;
        lastRideAt = 0L;
        movingStream = false;
        lastSampleAt = 0L;
        motionAnchor = null;
        lastSample = null;
        filterLoaded = true;
        prefs(context).edit()
            .remove("stable").remove("last").remove("lastAt")
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

    private static Location handleFix(Context context, Location location) {
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
        boolean moving = noteMovement(location, fixAt);
        long want = gpsInterval(moving, now);
        if (want != requestedGpsMs) {
            requestedGpsMs = want;
            registerUpdates(context, config);
        }
        lastSample = new Location(location);
        lastSampleAt = now;
        emit(location, fixAt);
        if (lastPublishedAt > 0) {
            long since = now - lastPublishedAt;
            float moved = lastPublished == null ? 9999f : lastPublished.distanceTo(location);
            long publishGap = moving ? PUBLISH_MOVING_MS : PUBLISH_STILL_MS;
            float publishMove = moving ? PUBLISH_MOVING_M : stayGate(lastPublished, location);
            if (since + 1_000L < publishGap && moved < publishMove) {
                rememberFilter(context);
                return null;
            }
        }
        lastPublished = new Location(location);
        lastPublishedAt = now;
        rememberFilter(context);
        scheduleHeartbeat(context);
        return new Location(location);
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
     * True only while the 2.5s stream should stay on.
     * Ambiguous fixes, a lone speed, and a 2s jump stay on the slow interval.
     */
    private static boolean noteMovement(Location fix, long fixAt) {
        float speed = fix.hasSpeed() ? fix.getSpeed() : -1f;
        if (motionAnchor == null) {
            motionAnchor = new Location(fix);
            motionAnchor.setTime(fixAt);
            stillSinceMs = fixAt;
            float opening = fix.hasSpeed() ? fix.getSpeed() : -1f;
            // Already at about 30 km/h: start the 1s stream on this fix so the
            // drive does not wait out a 2 minute hole before the next sample.
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
        boolean pacedWalk = dt >= WALK_DISPLACE_MS && dt <= 20_000L && moved >= WALK_DISPLACE_M && implied >= 0.75f && implied <= 12f;
        boolean pacedTrip = dt > 20_000L && moved >= WALK_DISPLACE_M && implied >= 0.75f && implied <= 45f;
        boolean reported = speed >= 0.8f && moved >= 8f && dt >= WALK_DISPLACE_MS && dt <= 20_000L;
        // Above a walk, the 4–20s window used to ignore anything faster than 12 m/s
        // unless a speed was reported inside that same window. A car then stayed on
        // the 2 minute request and the trail became one dashed chord.
        boolean rideReported = speed >= RIDE_MIN_MPS && moved >= RIDE_STEP_M && dt >= 1_000L && dt <= 30_000L && implied >= RIDE_MIN_MPS * 0.45f;
        boolean rideImplied = speed < 0f && dt >= 2_500L && dt <= 180_000L && moved >= RIDE_STAY_STEP_M && implied > 2.4f && implied <= 45f;
        if (pacedWalk || pacedTrip || reported || rideReported || rideImplied) {
            if (speed >= RIDE_MIN_MPS || implied >= RIDE_MIN_MPS) lastRideAt = fixAt;
            motionAnchor = new Location(fix);
            motionAnchor.setTime(fixAt);
            stillSinceMs = 0L;
            movingStream = true;
            return true;
        }
        if (!movingStream) {
            if (stillSinceMs == 0L) stillSinceMs = anchorAt;
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
            motionAnchor = new Location(fix);
            motionAnchor.setTime(fixAt);
            return false;
        }
        return true;
    }

    private static long gpsInterval(boolean moving, long now) {
        if (moving) {
            if (lastRideAt > 0L && now - lastRideAt <= MOVING_HOLD_MS) return GPS_RIDE_MS;
            return GPS_MOVING_MS;
        }
        long stillFor = stillSinceMs > 0L ? Math.max(0L, now - stillSinceMs) : 0L;
        if (stillFor >= STILL_LONG_AFTER_MS) return GPS_STILL_LONG_MS;
        if (lastRideAt > 0L && now - lastRideAt < RIDE_BRIDGE_FOR_MS) return RIDE_BRIDGE_MS;
        return GPS_STILL_MS;
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

    private static boolean publish(Context context, Location location) {
        JSONObject current = readConfig(context);
        if (current == null) return location == null;
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
        if (!prefs(context).getBoolean("registered", false)) return false;
        boolean changed = false;
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
                    if (envelope == null) continue;
                    body.put("lat", JSONObject.NULL);
                    body.put("lng", JSONObject.NULL);
                    body.put("accuracyM", 0);
                    body.put("seal", envelope);
                    if (battery >= 0) body.put("batteryPct", battery);
                    body.put("charging", charging);
                }
                if (putWithRetry(base, target.optString("token"), body, identified ? profileKey : "")) {
                    target.put("revokeSent", !sharing);
                    changed = true;
                }
            } catch (Exception ignored) {
                /* 다음 위치에서 다시 보낸다 */
            }
        }
        if (changed) prefs(context).edit().putString("config", current.toString()).apply();
        return true;
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
            return status >= 200 && status < 300;
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
