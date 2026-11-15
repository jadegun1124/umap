package kr.co.umap.tracker;

import android.content.Context;
import android.os.Build;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.concurrent.TimeUnit;

/**
 * 15 minute floor is the shortest periodic WorkManager interval.
 * KEEP leaves a pending run in place. The 2 minute exact alarm is the fast
 * revival when exact alarms are allowed. Doze idle alarms are about 9 minutes.
 * Expedited work is the extra path after a foreground start is denied.
 * This worker does not call startForegroundService unless battery exemption
 * makes that start legal. Otherwise it only arms the next alarm.
 */
public class KeepAliveWorker extends Worker {
    static final String NAME = "umap-keep-revive";
    static final String EXPEDITED = "umap-keep-expedite";

    public KeepAliveWorker(Context context, WorkerParameters params) {
        super(context, params);
    }

    public static void schedule(Context context) {
        if (context == null) return;
        try {
            PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(KeepAliveWorker.class, 15, TimeUnit.MINUTES).build();
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request);
        } catch (Exception ignored) {
            /* The alarm still restarts keep. */
        }
    }

    public static void enqueueExpedited(Context context) {
        if (context == null) return;
        try {
            OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(KeepAliveWorker.class)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build();
            WorkManager.getInstance(context).enqueueUniqueWork(EXPEDITED, ExistingWorkPolicy.KEEP, request);
        } catch (Exception ignored) {
            /* The periodic job and the alarm remain. */
        }
    }

    public static void cancel(Context context) {
        if (context == null) return;
        try {
            WorkManager manager = WorkManager.getInstance(context);
            manager.cancelUniqueWork(NAME);
            manager.cancelUniqueWork(EXPEDITED);
        } catch (Exception ignored) {
            /* Already gone. */
        }
    }

    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        NativeDiag.note(context, "revive", "work", -1, -1, -1, -1, false, "", 0, 0);
        if (!LocationKeepService.wanted(context) || LocationKeepService.userStopped(context)) {
            return Result.success();
        }
        boolean alive = LocationKeepProcess.isAlive();
        boolean exempt = LocationKeepService.batteryExempt(context);
        if (!alive && KeepRevive.fgsStartAllowed(Build.VERSION.SDK_INT, "work", exempt)) {
            LocationKeepProcess.hold(context, "work");
        } else if (!alive) {
            LocationKeepService.scheduleRevive(context);
        } else {
            LocationKeepService.pokeGps(context);
        }
        LocationKeepService.ensureWatchdog(context);
        return Result.success();
    }
}
