package kr.co.umap.tracker;

/**
 * How to bring location keep back after the process or the GPS registration dies.
 *
 * Android 12+ throws ForegroundServiceStartNotAllowedException unless the
 * start sits in an allowed window: the app is in front, an exact alarm
 * (setExactAndAllowWhileIdle or setAlarmClock) just fired, BOOT_COMPLETED,
 * MY_PACKAGE_REPLACED, a sticky restart the system already began, or the
 * app is exempt from battery optimizations. WorkManager and an inexact
 * setAndAllowWhileIdle alarm are not those windows.
 *
 * Doze delivers idle alarms about every 9–15 minutes. The inexact watchdog
 * waits 9 minutes so it is not queued faster than that window.
 * setAlarmClock would show a clock icon, so this build does not schedule it.
 * alarm-clock stays an allowed path if one is delivered.
 */
public final class KeepRevive {
    public static final long EXACT_WATCHDOG_MS = 2 * 60 * 1000L;
    /** Lower end of the Doze idle window (about 9–15 minutes). */
    public static final long IDLE_ALARM_MS = 9 * 60 * 1000L;
    public static final long EXACT_REVIVE_MS = 5_000L;

    private KeepRevive() {}

    public static boolean fgsStartAllowed(int sdk, String path, boolean batteryExempt) {
        if (sdk < 31) return true;
        if (batteryExempt) return true;
        if (path == null) return false;
        switch (path) {
            case "app":
            case "boot":
            case "update":
            case "alarm-exact":
            case "alarm-clock":
            case "sticky":
                return true;
            default:
                return false;
        }
    }

    public static long watchdogDelayMs(boolean exact) {
        return exact ? EXACT_WATCHDOG_MS : IDLE_ALARM_MS;
    }

    public static long reviveDelayMs(boolean exact) {
        return exact ? EXACT_REVIVE_MS : IDLE_ALARM_MS;
    }

    /**
     * The foreground service can still be up after the GPS registration is gone.
     * No registration in this process means it was dropped. A registration with
     * no fix past the moving or still stale time is dropped too, after cooldown.
     */
    public static boolean gpsDropped(boolean registered, long now, long lastFixAt, long lastReregisterAt, boolean moving, long cooldownMs, long movingStaleMs, long stillStaleMs) {
        if (!registered) return true;
        if (lastReregisterAt <= 0L) return false;
        if (now - lastReregisterAt < cooldownMs) return false;
        long stale = moving ? movingStaleMs : stillStaleMs;
        if (lastFixAt > 0L) return now - lastFixAt >= stale;
        return now - lastReregisterAt >= stale;
    }

    /** Expedited work is the extra path after a denied foreground start. A worker must not enqueue itself again. */
    public static boolean enqueueExpedited(String path) {
        return path == null || !"work".equals(path);
    }
}
