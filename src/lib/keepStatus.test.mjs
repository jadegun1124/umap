import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { keepStatus } from './keepStatus.mjs';

test('while-using and a restricted battery each get a fix, and 1.51 settings did not say so', () => {
  const both = keepStatus({ locationMode: 'while-using', batteryUnrestricted: false, serviceRunning: true });
  assert.equal(both.locationLabel, '앱 사용 중에만');
  assert.equal(both.batteryLabel, '최적화 중');
  assert.deepEqual(both.fixes.map((item) => item.action), ['always', 'battery']);
  const ready = keepStatus({ locationMode: 'always', batteryUnrestricted: true, serviceRunning: true });
  assert.deepEqual(ready.fixes, []);
  assert.equal(ready.serviceLabel, '동작 중');
  const notice = readFileSync(new URL('../components/family/AlwaysAllowNotice.tsx', import.meta.url), 'utf8');
  assert.match(notice, /keepStatus/);
  assert.match(notice, /item\.label/);
  assert.equal(notice.includes('7분이 넘으면 5분'), false);
  const screen = readFileSync(new URL('../components/family/FamilyMapScreen.tsx', import.meta.url), 'utf8');
  assert.match(screen, /kind: 'keep'/);
  assert.match(screen, /code:/);
  assert.match(screen, /battery:/);
});
