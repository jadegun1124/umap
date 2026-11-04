package kr.co.umap.tracker;

import android.content.Context;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.concurrent.TimeUnit;

/**
 * 15 minute floor is the shortest periodic WorkManager interval.
 * The 2 minute alarm is the fast revival. This runs if alarms are deferred.
 */
public class KeepAliveWorker extends Worker {
    static final String NAME = "umap-keep-revive";

    public KeepAliveWorker(Context context, WorkerParameters params) {
        super(context, params);
    }

    public static void schedule(Context context) {
        if (context == null) return;
        try {
            PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(KeepAliveWorker.class, 15, TimeUnit.MINUTES).build();
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, request);
        } catch (Exception ignored) {
            /* The alarm still restarts keep. */
        }
    }

    public static void cancel(Context context) {
        if (context == null) return;
        try {
            WorkManager.getInstance(context).cancelUniqueWork(NAME);
        } catch (Exception ignored) {
            /* Already gone. */
        }
    }

    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        if (!LocationKeepService.wanted(context) || LocationKeepService.userStopped(context)) {
            return Result.success();
        }
        if (!LocationKeepProcess.isAlive() || LocationKeepService.fixStale(context)) {
            // Android 12+ rejects startForegroundService from a background worker.
            // An exact alarm is allowed to bring the foreground service back.
            LocationKeepService.scheduleRevive(context);
        }
        return Result.success();
    }
}
