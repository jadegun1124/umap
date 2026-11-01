package kr.co.umap.tracker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Start location keep again after reboot or an APK update. No notification is posted. */
public class KeepAliveRestoreReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }
        LocationKeepService.restartIfWanted(context.getApplicationContext());
    }
}
