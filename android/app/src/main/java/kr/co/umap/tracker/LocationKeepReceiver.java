package kr.co.umap.tracker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.location.Location;

/** System location delivery. No notification is posted from this path. */
public class LocationKeepReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent != null && LocationKeepService.ACTION_HEARTBEAT.equals(intent.getAction())) {
            PendingResult pending = goAsync();
            LocationKeepService.onHeartbeat(context.getApplicationContext(), pending);
            return;
        }
        Location location = LocationKeepService.locationFrom(intent);
        if (location == null) return;
        PendingResult pending = goAsync();
        LocationKeepService.onFix(context.getApplicationContext(), location, pending);
    }
}
