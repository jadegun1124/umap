import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { KEEP_BANNER_DISMISS_MS, KEEP_RESTART_OK_MS, keepBanner, keepBannerVisible, keepRestartStatus, nextKeepPhase, serviceAlive } from './keepBanner.mjs';

test('an open map does not warn when background keep was never turned on', () => {
  assert.equal(keepBanner({
    native: true,
    onMap: true,
    serviceRunning: false,
    keepAlive: false,
    locationMode: 'while-using',
  }), null);
  assert.equal(keepBanner({
    native: true,
    onMap: true,
    serviceRunning: false,
    keepAlive: false,
    locationMode: 'always',
  }), null);
});

test('keep that the user asked for and the service is not running is a button', () => {
  const banner = keepBanner({
    native: true,
    onMap: true,
    serviceRunning: false,
    keepAlive: true,
    locationMode: 'always',
  });
  assert.equal(banner.action, 'start');
  assert.match(banner.text, /눌러서 다시 켭니다/);
  assert.equal(banner.text.includes('다시 열어'), false);
  assert.equal(banner.text.includes('가지 않습니다'), false);
});

test('keep without 항상 허용 opens the location setting', () => {
  const banner = keepBanner({
    native: true,
    onMap: true,
    serviceRunning: false,
    keepAlive: true,
    locationMode: 'while-using',
  });
  assert.equal(banner.action, 'always');
});

test('a stopped keep says when the permission or the battery is what blocked it', () => {
  const permission = keepBanner({
    native: true,
    onMap: true,
    serviceRunning: false,
    keepAlive: true,
    locationMode: 'always',
    reason: 'permission',
  });
  assert.equal(permission.action, 'always');
  assert.match(permission.text, /항상 허용이 아닙니다/);
  const battery = keepBanner({
    native: true,
    onMap: true,
    serviceRunning: false,
    keepAlive: true,
    locationMode: 'always',
    batteryUnrestricted: false,
  });
  assert.equal(battery.action, 'battery');
  assert.match(battery.text, /제한 없음/);
});

test('a fresh service beat with a stale GPS fix shows the stopped banner', () => {
  const now = 1_700_000_000_000;
  assert.equal(serviceAlive({
    serviceRunning: true,
    heartbeatAt: now - 10_000,
    lastFixAt: now - 120_000,
    now,
  }), false);
  const banner = keepBanner({
    native: true,
    onMap: true,
    serviceRunning: true,
    keepAlive: true,
    locationMode: 'always',
    heartbeatAt: now - 10_000,
    lastFixAt: now - 120_000,
    now,
  });
  assert.equal(banner.action, 'start');
  assert.equal(serviceAlive({
    serviceRunning: true,
    heartbeatAt: now - 10_000,
    lastFixAt: now - 20_000,
    now,
  }), true);
});

test('a fresh heartbeat hides the stopped banner, and a stale one shows it', () => {
  const now = 1_700_000_000_000;
  assert.equal(serviceAlive({ serviceRunning: false, heartbeatAt: now - 10_000, now }), true);
  assert.equal(serviceAlive({ serviceRunning: true, heartbeatAt: now - 120_000, now }), false);
  assert.equal(keepBanner({
    native: true,
    onMap: true,
    serviceRunning: false,
    keepAlive: true,
    locationMode: 'always',
    heartbeatAt: now - 10_000,
    now,
  }), null);
  const dead = keepBanner({
    native: true,
    onMap: true,
    serviceRunning: true,
    keepAlive: true,
    locationMode: 'always',
    heartbeatAt: now - 120_000,
    now,
  });
  assert.equal(dead.action, 'start');
  assert.match(dead.text, /위치 유지가 꺼져 있습니다/);
});

test('a running keep service only warns when the battery is restricted', () => {
  assert.equal(keepBanner({
    native: true,
    onMap: true,
    serviceRunning: true,
    keepAlive: true,
    locationMode: 'always',
    batteryUnrestricted: true,
  }), null);
  assert.equal(keepBanner({
    native: true,
    onMap: true,
    serviceRunning: true,
    keepAlive: true,
    locationMode: 'always',
    batteryUnrestricted: false,
  }).action, 'battery');
});

const wanted = {
  native: true,
  onMap: true,
  keepAlive: true,
  locationMode: 'always',
};

test('a dead keep says family location stops and offers restart plus settings', () => {
  const banner = keepBanner({ ...wanted, serviceRunning: false });
  assert.equal(banner.kind, 'dead');
  assert.equal(banner.primary, '다시 켜기');
  assert.equal(banner.settingsLabel, '설정으로 이동');
  assert.equal(banner.settingsAction, 'app');
  assert.match(banner.text, /가족 지도의 내 위치가 갱신되지 않습니다/);
  const permission = keepBanner({ ...wanted, serviceRunning: false, reason: 'permission' });
  assert.equal(permission.kind, 'permission');
  assert.equal(permission.primary, '');
  assert.equal(permission.settingsLabel, '권한 확인');
  assert.equal(permission.settingsAction, 'always');
  assert.match(permission.text, /가족 지도의 내 위치가 갱신되지 않습니다/);
  const battery = keepBanner({ ...wanted, serviceRunning: false, batteryUnrestricted: false });
  assert.equal(battery.kind, 'battery');
  assert.equal(battery.primary, '다시 켜기');
  assert.equal(battery.settingsLabel, '배터리 설정');
  assert.equal(battery.settingsAction, 'battery');
});

test('pause stays quiet, and a dismiss hides only the same blocker until the cooldown ends', () => {
  const now = 1_700_000_000_000;
  assert.equal(keepBanner({ ...wanted, serviceRunning: false, userStopped: true, now }), null);
  const dead = keepBanner({ ...wanted, serviceRunning: false, now });
  const dismissed = { kind: 'dead', at: now };
  assert.equal(keepBannerVisible(dead, dismissed, now + 1_000), null);
  assert.equal(keepBannerVisible(dead, dismissed, now + KEEP_BANNER_DISMISS_MS).kind, 'dead');
  const battery = keepBanner({ ...wanted, serviceRunning: false, batteryUnrestricted: false, now });
  assert.equal(keepBannerVisible(battery, dismissed, now + 1_000).kind, 'battery');
  assert.equal(keepBannerVisible(null, dismissed, now), null);
  assert.equal(keepRestartStatus('starting'), '다시 켜는 중입니다.');
  assert.match(keepRestartStatus('on'), /다시 켰습니다/);
  assert.match(keepRestartStatus('blocked'), /아직 켜지지 않았습니다/);
  assert.equal(keepRestartStatus('idle'), '');
});

test('a blocked restart becomes on once the service is alive, then idle', () => {
  const now = 5_000_000;
  const starting = { phase: 'starting', until: now + 1_500 };
  assert.equal(nextKeepPhase(starting, { alive: false, banner: { kind: 'dead' }, now: now + 100 }).phase, 'starting');
  assert.equal(nextKeepPhase(starting, { alive: false, banner: { kind: 'dead' }, now: now + 1_500 }).phase, 'blocked');
  const blocked = { phase: 'blocked', until: 0 };
  const recovered = nextKeepPhase(blocked, { alive: true, banner: null, now: now + 20_000 });
  assert.equal(recovered.phase, 'on');
  assert.equal(recovered.until, now + 20_000 + KEEP_RESTART_OK_MS);
  assert.equal(nextKeepPhase(recovered, { alive: true, banner: null, now: recovered.until - 1 }).phase, 'on');
  assert.equal(nextKeepPhase(recovered, { alive: true, banner: null, now: recovered.until }).phase, 'idle');
});

test('the map banner has a restart button, a settings path, and a dismiss control', () => {
  const screen = readFileSync(new URL('../components/family/FamilyMapScreen.tsx', import.meta.url), 'utf8');
  assert.match(screen, /keepBannerVisible/);
  assert.match(screen, /keepHint\.primary/);
  assert.match(screen, /keepHint\.settingsLabel/);
  assert.match(screen, /openAppSettings/);
  assert.match(screen, /keepRestartStatus/);
  assert.match(screen, /aria-label="나중에"/);
});
