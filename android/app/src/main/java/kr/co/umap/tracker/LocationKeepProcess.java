package kr.co.umap.tracker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.location.LocationManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

/**
 * Foreground location service. Android delivers GPS at the requested rate
 * only while this process is in the foreground; a PendingIntent alone is
 * deferred after the app is swiped away.
 *
 * A partial wake lock is held only while the 1s/2s moving stream is on, so
 * Samsung doze does not batch those fixes. The lock is released when the
 * phone is still. The cost while moving is a workout-style GNSS session.
 * While still, the radio wakes about every 20s and the CPU lock is off.
 */
public class LocationKeepProcess extends Service {
    public static final String CHANNEL_ID = "umap_keep_location";
    public static final int NOTIFICATION_ID = 6108;
    private static volatile boolean foreground;
    private static PowerManager.WakeLock movingLock;
    private BroadcastReceiver providers;
    private final Handler gpsWatch = new Handler(Looper.getMainLooper());
    private final Runnable pokeGps = new Runnable() {
        @Override
        public void run() {
            LocationKeepService.pokeGps(LocationKeepProcess.this);
            LocationKeepService.touchMovingWake(LocationKeepProcess.this);
            gpsWatch.postDelayed(this, FIX_WATCH_MS);
        }
    };
    private static final long FIX_WATCH_MS = 15_000L;
    /**
     * The timeout is what releases a stuck lock. It used to be 4 hours and was
     * not refreshed, so a long move lost the CPU lock and Samsung could stop
     * delivering GPS. The 15s poke and the 2 minute alarm take it again.
     */
    public static final long MOVING_WAKE_MS = 10L * 60L * 1000L;

    public static boolean isAlive() {
        return foreground;
    }

    public static void hold(Context context) {
        if (context == null) return;
        try {
            Intent intent = new Intent(context, LocationKeepProcess.class);
            intent.putExtra("fromKeep", true);
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (Exception ignored) {
            /* A background start limit leaves the PendingIntent and the alarm. */
        }
    }

    public static void release(Context context) {
        setMovingWake(context, false);
        if (context == null) return;
        try {
            context.stopService(new Intent(context, LocationKeepProcess.class));
        } catch (Exception ignored) {
            /* Already gone. */
        }
    }

    /** CPU stay-awake only for the moving GPS stream. Still probes do not hold it. */
    public static void setMovingWake(Context context, boolean moving) {
        if (context == null) return;
        Context app = context.getApplicationContext();
        synchronized (LocationKeepProcess.class) {
            if (!moving) {
                if (movingLock != null && movingLock.isHeld()) movingLock.release();
                return;
            }
            if (movingLock == null) {
                PowerManager power = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
                if (power == null) return;
                movingLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "kinnex:location-moving");
                movingLock.setReferenceCounted(false);
            }
            // Refresh the timeout even when the lock is already held. A second
            // acquire(timeout) can leave the first releaser in place.
            if (movingLock.isHeld()) movingLock.release();
            movingLock.acquire(MOVING_WAKE_MS);
        }
    }

    /** Keep a moving lock from expiring. A lock that is already down stays down. */
    public static void renewMovingWake(Context context) {
        if (context == null) return;
        synchronized (LocationKeepProcess.class) {
            if (movingLock == null || !movingLock.isHeld()) return;
        }
        setMovingWake(context, true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            promote();
        } catch (Exception error) {
            foreground = false;
            stopSelf();
            return START_NOT_STICKY;
        }
        foreground = true;
        LocationKeepService.noteHeartbeat(this);
        if (!LocationKeepService.wanted(this)) {
            foreground = false;
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent == null || !intent.getBooleanExtra("fromKeep", false)) {
            LocationKeepService.restartIfWanted(this);
        }
        LocationKeepService.ensureRunning(this);
        LocationKeepService.touchMovingWake(this);
        registerProviders();
        gpsWatch.removeCallbacks(pokeGps);
        gpsWatch.postDelayed(pokeGps, FIX_WATCH_MS);
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (!LocationKeepService.wanted(this)) return;
        hold(this);
        LocationKeepService.ensureWatchdog(this);
    }

    @Override
    public void onDestroy() {
        boolean revive = LocationKeepService.wanted(this);
        foreground = false;
        setMovingWake(this, false);
        gpsWatch.removeCallbacks(pokeGps);
        unregisterProviders();
        if (revive) LocationKeepService.scheduleRevive(this);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void registerProviders() {
        if (providers != null) return;
        providers = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                LocationKeepService.ensureRunning(context);
            }
        };
        IntentFilter filter = new IntentFilter(LocationManager.PROVIDERS_CHANGED_ACTION);
        filter.addAction(LocationManager.MODE_CHANGED_ACTION);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(providers, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(providers, filter);
        }
    }

    private void unregisterProviders() {
        if (providers == null) return;
        try {
            unregisterReceiver(providers);
        } catch (Exception ignored) {
            /* Already unregistered. */
        }
        providers = null;
    }

    private void promote() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && manager != null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "위치 유지", NotificationManager.IMPORTANCE_LOW);
            channel.setSound(null, null);
            channel.enableVibration(false);
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent content = PendingIntent.getActivity(this, 0, open, pendingFlags);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        builder.setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("위치 유지 중")
            .setContentText("앱을 닫아도 위치를 기록합니다")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(content);
        Notification notification = builder.build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }
}
