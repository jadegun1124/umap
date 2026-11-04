import assert from 'node:assert/strict';
import test from 'node:test';
import { keepBanner, serviceAlive } from './keepBanner.mjs';

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
