package kr.co.umap.tracker;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;

/**
 * Started service so a swipe-away and a process death can come back.
 * It does not call startForeground. An ongoing shade card is not posted.
 * Location updates themselves stay on the PendingIntent registration.
 */
public class LocationKeepProcess extends Service {
    public static void hold(Context context) {
        if (context == null) return;
        try {
            Intent intent = new Intent(context, LocationKeepProcess.class);
            intent.putExtra("fromKeep", true);
            context.startService(intent);
        } catch (Exception ignored) {
            /* A background start limit leaves the PendingIntent and the alarm. */
        }
    }

    public static void release(Context context) {
        if (context == null) return;
        try {
            context.stopService(new Intent(context, LocationKeepProcess.class));
        } catch (Exception ignored) {
            /* Already gone. */
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // A null intent is the system bringing the process back. Our own hold() is marked.
        if (intent == null || !intent.getBooleanExtra("fromKeep", false)) {
            LocationKeepService.restartIfWanted(this);
        }
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        LocationKeepService.restartIfWanted(this);
        LocationKeepService.ensureWatchdog(this);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
