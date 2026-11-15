import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ALLOWED_FGS_PATHS,
  EXACT_REVIVE_MS,
  EXACT_WATCHDOG_MS,
  FIX_STALE_MOVING_MS,
  FIX_STALE_STILL_MS,
  IDLE_ALARM_MS,
  enqueueExpedited,
  fgsStartAllowed,
  gpsDropped,
  reviveActions,
  reviveDelayMs,
  watchdogDelayMs,
} from './keepRevive.mjs';

const java = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/KeepRevive.java', import.meta.url), 'utf8');
const service = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/LocationKeepService.java', import.meta.url), 'utf8');
const process = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/LocationKeepProcess.java', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/KeepAliveWorker.java', import.meta.url), 'utf8');
const receiver = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/KeepAliveRestoreReceiver.java', import.meta.url), 'utf8');
const alarm = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/LocationKeepReceiver.java', import.meta.url), 'utf8');

test('foreground start is limited to the Android 12 windows, and Java lists the same paths', () => {
  for (const path of ALLOWED_FGS_PATHS) {
    assert.equal(fgsStartAllowed({ sdk: 31, path, batteryExempt: false }), true, path);
    assert.match(java, new RegExp(`case "${path}":`));
  }
  for (const path of ['work', 'alarm-idle', 'task', 'destroy']) {
    assert.equal(fgsStartAllowed({ sdk: 31, path, batteryExempt: false }), false, path);
  }
  assert.equal(fgsStartAllowed({ sdk: 31, path: 'work', batteryExempt: true }), true);
  assert.equal(fgsStartAllowed({ sdk: 30, path: 'work', batteryExempt: false }), true);
  assert.equal(fgsStartAllowed({ sdk: 31, path: '', batteryExempt: false }), false);
  assert.match(java, /ForegroundServiceStartNotAllowedException/);
  assert.match(process, /ForegroundServiceStartNotAllowedException/);
  assert.match(process, /fgs-denied/);
  assert.match(service, /setExactAndAllowWhileIdle/);
  assert.match(service, /setAndAllowWhileIdle/);
  assert.match(service, /canScheduleExactAlarms/);
});

test('a denied foreground start falls back to the alarm and expedited work, except from the worker', () => {
  const denied = reviveActions({
    processAlive: false,
    fgsAllowed: false,
    exact: true,
    path: 'alarm-idle',
  });
  assert.equal(denied.startService, false);
  assert.equal(denied.expedited, true);
  assert.equal(denied.periodic, true);
  assert.equal(denied.alarm, 'exact');
  assert.equal(denied.alarmMs, EXACT_REVIVE_MS);
  assert.equal(enqueueExpedited('work'), false);
  assert.equal(enqueueExpedited('destroy'), true);
  const fromWorker = reviveActions({ processAlive: false, fgsAllowed: false, exact: false, path: 'work' });
  assert.equal(fromWorker.expedited, false);
  assert.equal(fromWorker.alarm, 'idle');
  assert.equal(fromWorker.alarmMs, IDLE_ALARM_MS);
  const allowed = reviveActions({ processAlive: false, fgsAllowed: true, exact: true, path: 'boot' });
  assert.equal(allowed.startService, true);
  assert.equal(allowed.capture, true);
  assert.equal(allowed.expedited, false);
  assert.equal(watchdogDelayMs(true), EXACT_WATCHDOG_MS);
  assert.equal(watchdogDelayMs(false), IDLE_ALARM_MS);
  assert.equal(reviveDelayMs(true), 5_000);
  assert.equal(reviveDelayMs(false), IDLE_ALARM_MS);
  assert.match(java, /IDLE_ALARM_MS = 9 \* 60 \* 1000L/);
  assert.match(java, /EXACT_WATCHDOG_MS = 2 \* 60 \* 1000L/);
  assert.match(worker, /ExistingPeriodicWorkPolicy.KEEP/);
  assert.equal(worker.includes('ExistingPeriodicWorkPolicy.UPDATE'), false);
  assert.match(worker, /setExpedited/);
  assert.match(worker, /fgsStartAllowed/);
  assert.ok(worker.indexOf('fgsStartAllowed') < worker.indexOf('LocationKeepProcess.hold'));
  assert.match(alarm, /reviveFromAlarm/);
  assert.match(receiver, /"boot"/);
  assert.match(receiver, /"update"/);
  assert.match(process, /START_STICKY/);
  assert.match(process, /onTaskRemoved/);
  assert.match(process, /onDestroy/);
  assert.match(service, /fallbackAfterDenied/);
  assert.match(service, /REVIVE_CODE = HEARTBEAT_CODE \+ 1/);
  const reviveBody = service.slice(service.indexOf('void scheduleRevive'), service.indexOf('void scheduleHeartbeat'));
  assert.match(reviveBody, /reviveIntent/);
  assert.equal(reviveBody.includes('heartbeatIntent'), false);
  const beatBody = service.slice(service.indexOf('void scheduleHeartbeat'), service.indexOf('void scheduleAlarm'));
  assert.match(beatBody, /heartbeatIntent/);
  assert.equal(beatBody.includes('reviveIntent'), false);
  assert.match(service, /captureFreshFix/);
  assert.match(service, /motionMoving/);
});

test('the watchdog re-registers GPS when the service is up but the fix or the registration is gone', () => {
  const now = 1_000_000;
  assert.equal(gpsDropped({ registered: false, now, lastFixAt: now, lastReregisterAt: now }), true);
  assert.equal(gpsDropped({ registered: true, now, lastFixAt: 0, lastReregisterAt: 0 }), false);
  assert.equal(gpsDropped({
    registered: true,
    now,
    lastFixAt: now - 10_000,
    lastReregisterAt: now - 120_000,
    moving: true,
  }), false);
  assert.equal(gpsDropped({
    registered: true,
    now,
    lastFixAt: now - FIX_STALE_MOVING_MS,
    lastReregisterAt: now - 120_000,
    moving: true,
  }), true);
  assert.equal(gpsDropped({
    registered: true,
    now,
    lastFixAt: now - (FIX_STALE_STILL_MS - 1),
    lastReregisterAt: now - 120_000,
    moving: false,
  }), false);
  assert.equal(gpsDropped({
    registered: true,
    now,
    lastFixAt: now - FIX_STALE_STILL_MS,
    lastReregisterAt: now - 30_000,
    moving: false,
  }), false);
  assert.equal(gpsDropped({
    registered: true,
    now,
    lastFixAt: 0,
    lastReregisterAt: now - FIX_STALE_STILL_MS,
    moving: false,
  }), true);
  const whileAlive = reviveActions({ processAlive: true, gpsNeedsRegister: true, exact: true });
  assert.equal(whileAlive.startService, false);
  assert.equal(whileAlive.reregisterGps, true);
  assert.equal(whileAlive.capture, false);
  assert.match(service, /gpsDropped/);
  assert.match(service, /"reregister"/);
  assert.match(java, /if \(lastReregisterAt <= 0L\) return false/);
});

test('stopped keep does not revive, and diag reasons carry no coordinates', () => {
  const stopped = reviveActions({ wanted: false, processAlive: false });
  assert.equal(stopped.periodic, false);
  assert.equal(stopped.startService, false);
  const user = reviveActions({ userStopped: true, processAlive: false, fgsAllowed: true });
  assert.equal(user.alarm, 'none');
  assert.match(service, /"battery-exempt"/);
  assert.match(service, /"battery-optimized"/);
  const reviveNotes = service.split('\n').filter((line) => line.includes('"revive"'));
  assert.ok(reviveNotes.length > 0);
  assert.equal(reviveNotes.some((line) => line.includes('lat')), false);
  const notice = readFileSync(new URL('../components/family/AlwaysAllowNotice.tsx', import.meta.url), 'utf8');
  const status = readFileSync(new URL('./keepStatus.mjs', import.meta.url), 'utf8');
  assert.match(status, /앱을 오래 열지 않으면 휴대폰 절전 기능 때문에 위치가 잠시 올라오지 않을 수 있어요/);
  assert.match(status, /잠자지 않는 앱으로/);
  assert.match(notice, /idleWarning/);
  assert.match(notice, /item\.label/);
  const screen = readFileSync(new URL('../components/family/FamilyMapScreen.tsx', import.meta.url), 'utf8');
  const at = screen.indexOf('function DisclosureLogPanel');
  assert.match(screen.slice(at, at + 500), /useState\(false\)/);
});
