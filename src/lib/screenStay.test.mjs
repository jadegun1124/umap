import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function text(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('the open activity keeps the screen on and takes the flag again when it resumes', () => {
  const activity = text('../../android/app/src/main/java/kr/co/umap/tracker/MainActivity.java');
  assert.match(activity, /FLAG_KEEP_SCREEN_ON/);
  const resume = activity.slice(activity.indexOf('public void onResume'), activity.indexOf('public void onWindowFocusChanged'));
  const pause = activity.slice(activity.indexOf('public void onPause'), activity.indexOf('private void keepScreenOn'));
  assert.match(resume, /keepScreenOn\(true\)/);
  assert.match(pause, /keepScreenOn\(false\)/);
  const focus = activity.slice(activity.indexOf('public void onWindowFocusChanged'), activity.indexOf('public void onPause'));
  assert.match(focus, /keepScreenOn\(true\)/);
  const app = text('../components/family/FamilyApp.tsx');
  assert.match(app, /bindScreenWake\(\)/);
  const tracker = text('../services/liveGeolocation.ts');
  assert.match(tracker, /bindScreenWake\(\)/);
  assert.equal(tracker.includes('wakeLock.request'), false);
});

test('the moving wake lock is refreshed before its timeout and restored after a restart', () => {
  const process = text('../../android/app/src/main/java/kr/co/umap/tracker/LocationKeepProcess.java');
  const service = text('../../android/app/src/main/java/kr/co/umap/tracker/LocationKeepService.java');
  assert.match(process, /PARTIAL_WAKE_LOCK/);
  assert.match(process, /MOVING_WAKE_MS = 10L \* 60L \* 1000L/);
  assert.equal(process.includes('4L * 60L * 60L * 1000L'), false);
  assert.match(process, /if \(movingLock\.isHeld\(\)\) movingLock\.release\(\)/);
  assert.match(process, /movingLock\.acquire\(MOVING_WAKE_MS\)/);
  assert.match(process, /touchMovingWake\(LocationKeepProcess\.this\)/);
  assert.match(service, /void touchMovingWake/);
  assert.match(service, /putBoolean\("movingStream", movingStream\)/);
  assert.match(service, /getBoolean\("movingStream", false\)/);
  assert.match(service, /applyMovingWake\(context\)/);
  const manifest = text('../../android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:foregroundServiceType="location"/);
  assert.match(manifest, /FOREGROUND_SERVICE_LOCATION/);
});

test('samsung sleeping apps is a separate button and does not replace the battery banner', () => {
  const plugin = text('../../android/app/src/main/java/kr/co/umap/tracker/UmapLocationPlugin.java');
  assert.match(plugin, /openSamsungPower/);
  assert.match(plugin, /ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/);
  assert.match(plugin, /AppSleepListActivity/);
  assert.match(plugin, /isIgnoringBatteryOptimizations/);
  assert.match(plugin, /result\.put\("manufacturer"/);
  const screen = text('../components/family/FamilyMapScreen.tsx');
  assert.match(screen, /keepHint\.settingsLabel/);
  assert.match(screen, /keepHint\.samsungLabel/);
  assert.match(screen, /openSamsungPower/);
  assert.match(screen, /data-map-obstacle/);
  const map = text('../components/family/StreetMap.tsx');
  assert.match(map, /movingRef/);
  assert.match(map, /placeRef\.current\('moveend'\)/);
  assert.match(map, /movedEnough\(held\.marker/);
  assert.equal(map.includes('map.stop()'), false);
  assert.match(map, /zoomSnap: 0/);
  assert.match(map, /inertia: true/);
  assert.equal(map.includes('preferCanvas'), false);
  assert.match(map, /movingRef\.current && reason !== 'moveend'/);
  assert.equal(map.includes('dashArray'), false);
  const css = text('../index.css');
  assert.match(css, /touch-action: none/);
  assert.match(css, /overscroll-behavior: none/);
  const activity = text('../../android/app/src/main/java/kr/co/umap/tracker/MainActivity.java');
  const manifest = text('../../android/app/src/main/AndroidManifest.xml');
  assert.match(activity, /OVER_SCROLL_NEVER/);
  assert.match(activity, /LAYER_TYPE_HARDWARE/);
  assert.match(manifest, /android:hardwareAccelerated="true"/);
});
