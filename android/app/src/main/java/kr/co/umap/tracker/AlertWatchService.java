package kr.co.umap.tracker;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Polls the family sync worker for SOS, home-leave, motion start/stop, and new direct messages.
 * Each event is one shade notification. Web Push is used when the browser
 * can subscribe. This WebView cannot, so the phone schedules an exact alarm
 * after notification permission.
 *
 * The 1.6.0 data-sync foreground service posted an empty ongoing card.
 * Android 12+ keeps that card visible. This class does not call
 * startForeground and deletes the umap_alert_watch channel.
 */
public class AlertWatchService {
    public static final String ACTION_STOP = "kr.co.umap.tracker.STOP_ALERT_WATCH";
    public static final String ACTION_POLL = "kr.co.umap.tracker.ALERT_POLL";
    private static final String PREFS = "umap_alert_watch";
    private static final String ALERT_CHANNEL = "umap_alert";
    private static final String CHAT_CHANNEL = "umap_chat";
    private static final int WATCH_ID = OngoingNotificationCleanup.WATCH_NOTIFICATION_ID;
    private static final long POLL_MS = 12_000L;
    /** A success moves a stale alert cursor up to this close to now. */
    private static final long ALERT_CURSOR_OVERLAP_MS = 60_000L;
    /** 401, 403, 503, and network misses wait 5s, 15s, 45s, 2m, then 10m. An OK response clears it. */
    private static final SyncBackoff POLL_BACKOFF = new SyncBackoff();
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();

    private static volatile Context appContext;
    private static volatile String lastError;

    public static void attach(Context context) {
        appContext = context.getApplicationContext();
    }

    public static boolean isRunning() {
        Context context = appContext;
        return context != null && isArmed(context);
    }

    public static boolean isArmed(Context context) {
        return prefs(context).getBoolean("armed", false);
    }

    public static String lastError() {
        return lastError;
    }

    public static boolean start(Context context, String configJson) {
        attach(context);
        OngoingNotificationCleanup.clear(context);
        if (!writeConfig(context, configJson)) {
            lastError = "config";
            return false;
        }
        if (Build.VERSION.SDK_INT >= 33
            && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            lastError = "notifications";
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
        ensureAlertChannel(context);
        prefs(context).edit().putBoolean("armed", true).commit();
        schedule(context, System.currentTimeMillis() + 1_000L);
        return true;
    }

    public static void stop(Context context) {
        attach(context);
        prefs(context).edit().remove("config").putBoolean("armed", false).putBoolean("userStopped", false).commit();
        cancelAlarm(context);
        OngoingNotificationCleanup.clear(context);
    }

    public static void disarmFromUser(Context context) {
        attach(context);
        prefs(context).edit().remove("config").putBoolean("armed", false).putBoolean("userStopped", true).commit();
        cancelAlarm(context);
        OngoingNotificationCleanup.clear(context);
    }

    public static boolean userStopped(Context context) {
        return prefs(context).getBoolean("userStopped", false);
    }

    public static void pollThenSchedule(Context context, BroadcastReceiver.PendingResult pending) {
        attach(context);
        IO.execute(() -> {
            try {
                if (!isArmed(context)) return;
                pull(context);
            } finally {
                if (isArmed(context)) {
                    long now = System.currentTimeMillis();
                    schedule(context, now + Math.max(POLL_MS, POLL_BACKOFF.remaining(now)));
                }
                if (pending != null) pending.finish();
            }
        });
    }

    private static void disarm(Context context) {
        prefs(context).edit().putBoolean("armed", false).commit();
        cancelAlarm(context);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static boolean writeConfig(Context context, String configJson) {
        try {
            JSONObject parsed = new JSONObject(configJson);
            if (!allowedBase(parsed.optString("baseUrl", ""))) return false;
            if (parsed.optJSONArray("rooms") != null) {
                if (!validRooms(parsed.optJSONArray("rooms"))) return false;
            } else {
                String code = parsed.optString("code", "");
                String token = parsed.optString("token", "");
                String readKey = parsed.optString("readKey", "");
                if (!code.matches("\\d{4,6}")) return false;
                if (!token.matches("[A-Za-z0-9_-]{16,64}\\.[A-Za-z0-9_-]{16,64}")) return false;
                if (!readKey.matches("[A-Za-z0-9_-]{16,64}")) return false;
            }
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

    private static PendingIntent pollIntent(Context context) {
        Intent intent = new Intent(context, AlertWatchReceiver.class);
        intent.setAction(ACTION_POLL);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, WATCH_ID, intent, flags);
    }

    private static void schedule(Context context, long triggerAt) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        PendingIntent pending = pollIntent(context);
        if (Build.VERSION.SDK_INT >= 31) {
            try {
                if (alarms.canScheduleExactAlarms()) {
                    alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
                    return;
                }
            } catch (SecurityException ignored) {
                /* 정확한 알람이 막히면 절전 허용 알람으로 내려간다 */
            }
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
            return;
        }
        alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
    }

    private static void cancelAlarm(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        alarms.cancel(pollIntent(context));
    }

    private static void ensureAlertChannel(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel alert = new NotificationChannel(ALERT_CHANNEL, "Kinnex 알림", NotificationManager.IMPORTANCE_HIGH);
        alert.setDescription("SOS, 집 반경, 움직임 시작과 멈춤을 알려 줍니다.");
        alert.enableVibration(true);
        manager.createNotificationChannel(alert);
        NotificationChannel chat = new NotificationChannel(CHAT_CHANNEL, "Kinnex 대화", NotificationManager.IMPORTANCE_HIGH);
        chat.setDescription("새 대화가 오면 보낸 사람과 짧은 내용을 알려 줍니다.");
        chat.enableVibration(true);
        manager.createNotificationChannel(chat);
    }

    private static boolean validRooms(org.json.JSONArray rooms) {
        if (rooms.length() < 1 || rooms.length() > 8) return false;
        for (int index = 0; index < rooms.length(); index += 1) {
            JSONObject room = rooms.optJSONObject(index);
            if (room == null) return false;
            String code = room.optString("code", "");
            String token = room.optString("token", "");
            String readKey = room.optString("readKey", "");
            String me = room.optString("me", "").trim();
            if (!code.matches("\\d{4,6}")) return false;
            if (!token.matches("[A-Za-z0-9_-]{16,64}\\.[A-Za-z0-9_-]{16,64}")) return false;
            boolean alerts = readKey.matches("[A-Za-z0-9_-]{16,64}");
            boolean chat = validMe(me);
            if (!alerts && !chat) return false;
        }
        return true;
    }

    private static boolean validMe(String me) {
        if (me == null) return false;
        String name = me.trim();
        if (name.isEmpty() || name.length() > 20) return false;
        String digits = name.replaceAll("\\D", "");
        return digits.length() < 8;
    }

    private static int outcomeRank(int status) {
        if (status < 0) return 4;
        if (status == 401 || status == 403) return 3;
        if (status >= 500 && status <= 599) return 2;
        if (status >= 200 && status < 300) return 1;
        return 0;
    }

    private static int worseStatus(int left, int right) {
        return outcomeRank(right) > outcomeRank(left) ? right : left;
    }

    private static void pull(Context context) {
        JSONObject current = readConfig(context);
        if (!isArmed(context) || current == null) return;
        String base = current.optString("baseUrl", "").replaceAll("/+$", "");
        if (!allowedBase(base)) return;
        int status = 0;
        org.json.JSONArray rooms = current.optJSONArray("rooms");
        if (rooms == null) {
            status = pullRoom(context, base, current);
        } else {
            for (int index = 0; index < rooms.length(); index += 1) {
                JSONObject room = rooms.optJSONObject(index);
                if (room != null) status = worseStatus(status, pullRoom(context, base, room));
            }
        }
        if (outcomeRank(status) >= 2) POLL_BACKOFF.fail(System.currentTimeMillis());
        else if (outcomeRank(status) == 1) POLL_BACKOFF.succeed();
    }

    private static int pullRoom(Context context, String base, JSONObject room) {
        String code = room.optString("code", "");
        String token = room.optString("token", "");
        String readKey = room.optString("readKey", "");
        String me = room.optString("me", "").trim();
        if (!code.matches("\\d{4,6}") || !token.matches("[A-Za-z0-9_-]{16,64}\\.[A-Za-z0-9_-]{16,64}")) return 0;
        int status = 0;
        if (readKey.matches("[A-Za-z0-9_-]{16,64}")) status = pullAlerts(context, base, code, token, readKey, me, room);
        if (validMe(me)) status = worseStatus(status, pullChat(context, base, code, token, me, !MainActivity.isResumed(), room));
        return status;
    }

    /** Member headers let a room that already has owners accept this poll. */
    private static void stampIdentity(HttpURLConnection connection, JSONObject room) {
        String memberId = room.optString("memberId", "");
        String profileKey = room.optString("profileKey", "");
        if (memberId.matches("local-[a-z0-9]{3,64}")) connection.setRequestProperty("x-umap-member", memberId);
        if (profileKey.matches("[A-Za-z0-9_\\-]{16,64}")) connection.setRequestProperty("x-umap-profile-key", profileKey);
        connection.setRequestProperty("X-App-Version", BuildConfig.VERSION_NAME + " " + BuildConfig.VERSION_CODE);
    }

    private static boolean motionForMe(JSONObject alert, String me) {
        if (!validMe(me)) return false;
        JSONArray to = alert.optJSONArray("to");
        if (to == null) return false;
        for (int index = 0; index < to.length(); index += 1) {
            if (me.equals(to.optString(index, "").trim())) return true;
        }
        return false;
    }

    private static int pullAlerts(Context context, String base, String code, String token, String readKey, String me, JSONObject room) {
        long since = prefs(context).getLong("since", 0L);
        if (since == 0L) since = System.currentTimeMillis() - 60_000L;
        HttpURLConnection connection = null;
        try {
            URL url = new URL(base + "/v1/rooms/" + code + "?since=" + since);
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("x-umap-sync-key", token);
            connection.setRequestProperty("x-umap-read-key", readKey);
            stampIdentity(connection, room);
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) return status;
            JSONObject body = new JSONObject(readStream(connection.getInputStream()));
            JSONArray alerts = body.optJSONArray("alerts");
            if (alerts == null) return status;
            Set<String> seen = prefs(context).getStringSet("seen", new HashSet<>());
            Set<String> nextSeen = new HashSet<>(seen == null ? new HashSet<>() : seen);
            long cursor = since;
            for (int index = 0; index < alerts.length(); index += 1) {
                JSONObject alert = alerts.optJSONObject(index);
                if (alert == null) continue;
                String id = alert.optString("id", "");
                String kind = alert.optString("kind", "");
                long at = alert.optLong("at", 0L);
                if (id.isEmpty() || at <= since || nextSeen.contains(id)) continue;
                if ("motion".equals(kind)) {
                    if (!motionForMe(alert, me)) continue;
                    notifyMotion(context, alert);
                    nextSeen.add(id);
                    if (at > cursor) cursor = at;
                    continue;
                }
                if (!"sos".equals(kind) && !"leave".equals(kind)) continue;
                notifyAlert(context, alert);
                nextSeen.add(id);
                if (at > cursor) cursor = at;
            }
            while (nextSeen.size() > 30) {
                String first = nextSeen.iterator().next();
                nextSeen.remove(first);
            }
            long floor = System.currentTimeMillis() - ALERT_CURSOR_OVERLAP_MS;
            if (cursor < floor) cursor = floor;
            prefs(context).edit().putLong("since", cursor).putStringSet("seen", nextSeen).apply();
            return status;
        } catch (Exception ignored) {
            /* 다음 주기에 다시 받는다 */
            return -1;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static int pullChat(Context context, String base, String code, String token, String me, boolean notify, JSONObject room) {
        String sinceKey = "chatSince_" + code;
        long since = prefs(context).getLong(sinceKey, 0L);
        if (since == 0L) since = System.currentTimeMillis() - 60_000L;
        HttpURLConnection connection = null;
        try {
            String encoded = URLEncoder.encode(me, "UTF-8");
            URL url = new URL(base + "/v1/rooms/" + code + "/chat?me=" + encoded);
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("x-umap-sync-key", token);
            stampIdentity(connection, room);
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) return status;
            JSONObject body = new JSONObject(readStream(connection.getInputStream()));
            JSONArray threads = body.optJSONArray("threads");
            if (threads == null) return status;
            Set<String> seen = prefs(context).getStringSet("chatSeen", new HashSet<>());
            Set<String> nextSeen = new HashSet<>(seen == null ? new HashSet<>() : seen);
            long cursor = since;
            ArrayList<JSONObject> fresh = new ArrayList<>();
            for (int threadIndex = 0; threadIndex < threads.length(); threadIndex += 1) {
                JSONObject thread = threads.optJSONObject(threadIndex);
                if (thread == null) continue;
                JSONArray messages = thread.optJSONArray("messages");
                if (messages == null) continue;
                for (int index = 0; index < messages.length(); index += 1) {
                    JSONObject message = messages.optJSONObject(index);
                    if (message == null) continue;
                    String id = message.optString("id", "");
                    String from = message.optString("from", "").trim();
                    long at = message.optLong("at", 0L);
                    if (id.isEmpty() || at <= since) continue;
                    if (at > cursor) cursor = at;
                    if (from.isEmpty() || from.equals(me) || nextSeen.contains(id)) continue;
                    fresh.add(message);
                    nextSeen.add(id);
                }
            }
            if (notify) {
                int start = Math.max(0, fresh.size() - 3);
                for (int index = start; index < fresh.size(); index += 1) {
                    JSONObject message = fresh.get(index);
                    message.put("code", code);
                    notifyChat(context, message);
                }
            }
            while (nextSeen.size() > 40) {
                String first = nextSeen.iterator().next();
                nextSeen.remove(first);
            }
            long floor = System.currentTimeMillis() - ALERT_CURSOR_OVERLAP_MS;
            if (cursor < floor) cursor = floor;
            prefs(context).edit().putLong(sinceKey, cursor).putStringSet("chatSeen", nextSeen).apply();
            return status;
        } catch (Exception ignored) {
            /* 다음 주기에 다시 받는다 */
            return -1;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static void notifyAlert(Context context, JSONObject alert) {
        String kind = alert.optString("kind", "");
        String title = "sos".equals(kind) ? "SOS" : "집 반경을 나갔습니다";
        String body = alert.optString("body", "");
        if (body.length() > 200) body = body.substring(0, 200);
        int id = 5200 + (alert.optString("id", title).hashCode() & 0x0fff);
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        ensureAlertChannel(context);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(context, ALERT_CHANNEL)
            : new Notification.Builder(context);
        builder.setContentTitle(title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentIntent(content)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_ALARM);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(id, builder.build());
    }

    private static void notifyMotion(Context context, JSONObject alert) {
        String body = alert.optString("body", "").trim();
        if (body.isEmpty()) return;
        if (body.length() > 80) body = body.substring(0, 80);
        int id = 5400 + (alert.optString("id", body).hashCode() & 0x0fff);
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        ensureAlertChannel(context);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(context, ALERT_CHANNEL)
            : new Notification.Builder(context);
        builder.setContentTitle(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentIntent(content)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_STATUS);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(id, builder.build());
    }

    private static void notifyChat(Context context, JSONObject message) {
        if (Build.VERSION.SDK_INT >= 33
            && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        String code = message.optString("code", "");
        String from = message.optString("from", "").trim();
        String body = preview(message.optString("text", ""));
        if (!code.matches("\\d{4,6}") || from.isEmpty() || body.isEmpty()) return;
        int id = 6200 + ((code + "\0" + from).hashCode() & 0x0fff);
        Intent open = new Intent(context, MainActivity.class);
        open.setAction("kr.co.umap.tracker.OPEN_CHAT");
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra("umap_chat_code", code);
        open.putExtra("umap_chat_peer", from);
        PendingIntent content = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        ensureAlertChannel(context);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(context, CHAT_CHANNEL)
            : new Notification.Builder(context);
        builder.setContentTitle(from)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentIntent(content)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_MESSAGE);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(id, builder.build());
    }

    private static String preview(String text) {
        String trimmed = text == null ? "" : text.trim();
        if (trimmed.length() <= 80) return trimmed;
        return trimmed.substring(0, 79) + "…";
    }

    private static String readStream(InputStream stream) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[2048];
        int read;
        while ((read = stream.read(buffer)) >= 0) {
            output.write(buffer, 0, read);
            if (output.size() > 65_536) break;
        }
        return output.toString(StandardCharsets.UTF_8);
    }
}
