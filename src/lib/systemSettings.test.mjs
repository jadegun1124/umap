import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { APP_DETAILS_ACTION, BATTERY_POPUP_ACTION, LOCATION_PERMISSION_ACTION, LOCATION_PERMISSION_GROUP, LOCATION_PERMISSION_LIST_ACTION, alwaysAllowAction, alwaysAllowScreens, batteryAction, keepEntryPrompt, motionAction, notificationAction, whileUsingAction } from './systemSettings.mjs';

test('android permission buttons open system prompts instead of skipping', () => {
  assert.equal(notificationAction(true), 'post-notifications');
  assert.equal(whileUsingAction(true), 'foreground-location');
  assert.equal(alwaysAllowAction(true), 'location-settings');
  assert.equal(motionAction(true, false), 'activity-recognition');
  assert.equal(batteryAction(true), 'ignore-battery-optimizations');
});

test('always-allow opens the location radio, then the app permission list, then app info', () => {
  assert.equal(LOCATION_PERMISSION_ACTION, 'android.intent.action.MANAGE_APP_PERMISSION');
  assert.equal(LOCATION_PERMISSION_GROUP, 'android.permission-group.LOCATION');
  assert.equal(LOCATION_PERMISSION_LIST_ACTION, 'android.intent.action.MANAGE_APP_PERMISSIONS');
  assert.equal(APP_DETAILS_ACTION, 'android.settings.APPLICATION_DETAILS_SETTINGS');
  assert.deepEqual(alwaysAllowScreens(), ['location-radio', 'app-permissions', 'app-details']);
  assert.equal(BATTERY_POPUP_ACTION, 'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS');
  assert.equal(BATTERY_POPUP_ACTION.includes('IGNORE_BATTERY_OPTIMIZATION_SETTINGS'), false);
  const plugin = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/UmapLocationPlugin.java', import.meta.url), 'utf8');
  const open = plugin.slice(plugin.indexOf('private boolean openAlwaysSettings'), plugin.indexOf('private void noteOpened'));
  assert.ok(open.indexOf('openLocationRadio') < open.indexOf('openAppPermissions'));
  assert.ok(open.indexOf('openAppPermissions') < open.indexOf('openAppDetails'));
  const radio = plugin.slice(plugin.indexOf('private boolean openLocationRadio'), plugin.indexOf('private boolean openAppPermissions'));
  assert.ok(radio.indexOf('com.samsung.android.permissioncontroller') < radio.indexOf('startExplicit'));
  const intent = plugin.slice(plugin.indexOf('private Intent locationRadioIntent'), plugin.indexOf('private Intent appPermissionsIntent'));
  assert.match(intent, /PERMISSION_GROUP_NAME/);
  assert.match(intent, /EXTRA_APP_PACKAGE/);
  assert.match(intent, /myUserHandle/);
  assert.equal(intent.includes('ACCESS_FINE_LOCATION'), false);
  assert.match(plugin, /android.permission-group.LOCATION/);
  assert.match(plugin, /ManageAppPermissionActivity/);
  assert.ok(radio.indexOf('ManagePermissionsActivity') < radio.indexOf('com.google.android.permissioncontroller'));
  const fallback = plugin.slice(plugin.indexOf('private void advanceFallback'), plugin.indexOf('private Intent locationRadioIntent'));
  assert.ok(fallback.indexOf('hasWindowFocus') < fallback.indexOf('openAppDetails'));
  assert.ok(fallback.indexOf('location-radio') < fallback.indexOf('openAppDetails'));
  const resume = plugin.slice(plugin.indexOf('protected void handleOnResume'), plugin.indexOf('public void openBattery'));
  assert.equal(resume.includes('advanceFallback'), false);
  assert.ok(resume.indexOf('scheduleBounceConfirm') < resume.indexOf('resolveAlways'));
});

test('keep-alive notification is asked at entry until allowed, and started only after an explicit tap', () => {
  const base = { notifications: 'unknown', locationMode: 'unknown', keepAlive: false, permissionAsked: false, startAsked: false };
  assert.equal(keepEntryPrompt(base), 'permission');
  assert.equal(keepEntryPrompt({ ...base, notifications: 'denied' }), 'permission');
  assert.equal(keepEntryPrompt({ ...base, notifications: 'denied', permissionAsked: true }), 'none');
  assert.equal(keepEntryPrompt({ ...base, notifications: 'skipped' }), 'none');
  assert.equal(keepEntryPrompt({ ...base, notifications: 'granted', locationMode: 'while-using' }), 'none');
  assert.equal(keepEntryPrompt({ ...base, notifications: 'granted', locationMode: 'always' }), 'start');
  assert.equal(keepEntryPrompt({ ...base, notifications: 'granted', locationMode: 'always', startAsked: true }), 'none');
  assert.equal(keepEntryPrompt({ ...base, notifications: 'granted', locationMode: 'always', keepAlive: true }), 'none');
});

test('location keep is a foreground service that restarts with the task and the phone', () => {
  const location = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/LocationKeepService.java', import.meta.url), 'utf8');
  const watch = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/AlertWatchService.java', import.meta.url), 'utf8');
  const cleanup = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/OngoingNotificationCleanup.java', import.meta.url), 'utf8');
  const manifest = readFileSync(new URL('../../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  const process = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/LocationKeepProcess.java', import.meta.url), 'utf8');
  const plugin = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/UmapLocationPlugin.java', import.meta.url), 'utf8');
  assert.equal(watch.includes('startForeground('), false);
  assert.match(location, /requestLocationUpdates/);
  assert.match(location, /GPS_PROVIDER/);
  assert.match(process, /startForeground\(/);
  assert.match(process, /FOREGROUND_SERVICE_TYPE_LOCATION/);
  assert.match(process, /return START_STICKY/);
  assert.match(process, /onTaskRemoved/);
  assert.match(process, /PARTIAL_WAKE_LOCK/);
  assert.match(process, /위치 유지 중/);
  assert.match(manifest, /android:foregroundServiceType="location"/);
  assert.match(manifest, /FOREGROUND_SERVICE_LOCATION/);
  assert.match(manifest, /WAKE_LOCK/);
  assert.match(manifest, /REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/);
  assert.match(manifest, /stopWithTask="false"/);
  assert.match(manifest, /BOOT_COMPLETED/);
  assert.match(manifest, /MY_PACKAGE_REPLACED/);
  assert.match(plugin, /ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/);
  assert.match(plugin, /isIgnoringBatteryOptimizations/);
  assert.match(plugin, /heartbeatAt/);
  assert.match(location, /KEEP_HEARTBEAT_FRESH_MS = 90_000L/);
  assert.match(location, /WATCHDOG_ALARM_MS = 2 \* 60 \* 1000L/);
  assert.match(location, /FIX_STALE_MOVING_MS = 15_000L/);
  assert.match(location, /FIX_STALE_STILL_MS = 90_000L/);
  assert.match(location, /setExactAndAllowWhileIdle/);
  assert.match(location, /lastFixAt/);
  assert.match(process, /scheduleRevive/);
  assert.match(process, /PROVIDERS_CHANGED_ACTION/);
  const worker = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/KeepAliveWorker.java', import.meta.url), 'utf8');
  assert.match(worker, /PeriodicWorkRequest/);
  assert.match(worker, /15, TimeUnit.MINUTES/);
  assert.match(worker, /scheduleRevive/);
  assert.equal(worker.includes('LocationKeepProcess.hold'), false);
  assert.match(process, /pokeGps/);
  assert.match(process, /15_000L/);
  assert.match(location, /void pokeGps/);
  assert.match(location, /LocationKeepProcess\.hold/);
  assert.match(watch, /setExactAndAllowWhileIdle/);
  assert.match(watch, /SOS/);
  assert.match(cleanup, /deleteNotificationChannel\(LOCATION_CHANNEL\)/);
  const statusBody = plugin.slice(plugin.indexOf('public void status'), plugin.indexOf('public void ackStopped'));
  assert.match(statusBody, /while-using/);
  assert.match(statusBody, /isIgnoringBatteryOptimizations/);
  assert.match(statusBody, /heartbeatAt/);
});

test('motion start and stop are one shade each and do not raise an ongoing card', () => {
  const watch = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/AlertWatchService.java', import.meta.url), 'utf8');
  const location = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/LocationKeepService.java', import.meta.url), 'utf8');
  assert.match(watch, /"motion"\.equals\(kind\)/);
  assert.match(watch, /motionForMe/);
  assert.match(watch, /CATEGORY_STATUS/);
  assert.match(watch, /notifyMotion/);
  assert.equal(watch.includes('startForeground('), false);
  assert.match(location, /GPS_MOVING_MS = 2_000L/);
  assert.match(location, /GPS_RIDE_MS = 1_000L/);
  assert.equal(location.includes('GPS_MOVING_MS = 2_500L'), false);
});

test('chat shade notification is one event and opens that conversation', () => {
  const watch = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/AlertWatchService.java', import.meta.url), 'utf8');
  const activity = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/MainActivity.java', import.meta.url), 'utf8');
  const plugin = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/UmapLocationPlugin.java', import.meta.url), 'utf8');
  assert.equal(watch.includes('startForeground('), false);
  assert.equal(watch.includes('Umap 위치 공유'), false);
  assert.match(watch, /CHAT_CHANNEL = "umap_chat"/);
  assert.match(watch, /Kinnex 대화/);
  assert.match(watch, /\/chat\?me=/);
  assert.match(watch, /umap_chat_peer/);
  assert.match(watch, /CATEGORY_MESSAGE/);
  assert.match(watch, /pullChat\(context, base, code, token, me, !MainActivity\.isResumed\(\)\)/);
  assert.match(activity, /umap_chat_code/);
  assert.match(activity, /UmapLocationPlugin\.openChat/);
  assert.match(plugin, /consumePendingChat/);
  assert.match(plugin, /notifyListeners\("chat"/);
});

test('gps is 2s while walking, 1s while riding, and a stay probe never becomes a trail point', () => {
  const location = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/LocationKeepService.java', import.meta.url), 'utf8');
  assert.match(location, /GPS_MOVING_MS = 2_000L/);
  assert.match(location, /GPS_RIDE_MS = 1_000L/);
  assert.match(location, /UPLOAD_MOVING_MS = 30_000L/);
  assert.match(location, /UPLOAD_STILL_MS = 60_000L/);
  assert.equal(location.includes('PUBLISH_MOVING_M'), false);
  assert.match(location, /requestedGpsMs < GPS_RIDE_MS \? GPS_RIDE_MS/);
  assert.match(location, /SAMPLE_GAP_MS = 800L/);
  assert.match(location, /GPS_STILL_PROBE_MS = 20_000L/);
  assert.match(location, /GPS_STILL_MS = 20_000L/);
  assert.match(location, /GPS_STILL_LONG_MS = 20_000L/);
  assert.match(location, /GPS_STILL_MAX_MS = 30_000L/);
  assert.match(location, /GPS_AMBIGUOUS_MS = 15_000L/);
  assert.match(location, /STILL_LONG_AFTER_MS = 7 \* 60_000L/);
  assert.match(location, /RIDE_BRIDGE_MS = 15_000L/);
  assert.match(location, /recordFix\(moving\)/);
  assert.match(location, /return moving;/);
  assert.match(location, /GPS_PROVIDER, gpsMs, 0f/);
  assert.equal(location.includes('GPS_STILL_MS = 60_000L'), false);
  assert.equal(location.includes('GPS_STILL_MAX_MS = 120_000L'), false);
  assert.equal(location.includes('GPS_MOVING_MS = 2_500L'), false);
});

test('browser permission buttons stay inside the browser prompt', () => {
  assert.equal(notificationAction(false), 'web-notification');
  assert.equal(alwaysAllowAction(false), 'browser-geolocation');
  assert.equal(motionAction(false, true), 'ios-motion-prompt');
  assert.equal(motionAction(false, false), 'explain-only');
  assert.equal(batteryAction(false), 'explain-only');
});
