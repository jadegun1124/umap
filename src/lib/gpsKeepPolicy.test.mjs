import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { settleTrailPoint, trailDrawParts } from './tracking.mjs';
import { POLICY_151, eastOf, policyFromJava, replayFixes, simulateLongStayWalk } from './gpsKeepPolicy.mjs';

const java = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/LocationKeepService.java', import.meta.url), 'utf8');
const keepCopy = readFileSync(new URL('../components/family/FamilyMapScreen.tsx', import.meta.url), 'utf8');

function passesDenseWalkStart(result) {
  return result.msToMoving <= 120_000
    && result.openingChordM <= 120 * 1.2 + 1
    && result.stayPoints === 1
    && result.movingGaps.length >= 20
    && result.movingGaps.every((gap) => gap === 2_500);
}

test('the walk-start test runs the JS mirror, and Java gpsInterval cannot reorder without this failing', () => {
  const mirror = readFileSync(new URL('./gpsKeepPolicy.mjs', import.meta.url), 'utf8');
  const names = ['GPS_RIDE_MS', 'GPS_MOVING_MS', 'RIDE_BRIDGE_MS', 'GPS_AMBIGUOUS_MS', 'GPS_STILL_PROBE_MS', 'GPS_STILL_LONG_MS', 'GPS_STILL_MS', 'GPS_STILL_MAX_MS'];
  const javaBody = java.slice(java.indexOf('private static long gpsInterval'), java.indexOf('private static void emit'));
  const mirrorBody = mirror.slice(mirror.indexOf('function gpsInterval'), mirror.indexOf('function noteMovement'));
  const mirrorName = {
    GPS_RIDE_MS: 'rideMs',
    GPS_MOVING_MS: 'movingMs',
    RIDE_BRIDGE_MS: 'rideBridgeMs',
    GPS_AMBIGUOUS_MS: 'ambiguousMs',
    GPS_STILL_PROBE_MS: 'stillProbeMs',
    GPS_STILL_LONG_MS: 'stillLongMs',
    GPS_STILL_MS: 'stillMs',
    GPS_STILL_MAX_MS: 'stillMaxMs',
  };
  let javaAt = 0;
  let mirrorAt = 0;
  for (const name of names) {
    javaAt = javaBody.indexOf(name, javaAt);
    mirrorAt = mirrorBody.indexOf(mirrorName[name], mirrorAt);
    assert.ok(javaAt >= 0, name);
    assert.ok(mirrorAt >= 0, name);
    javaAt += name.length;
    mirrorAt += mirrorName[name].length;
  }
  assert.match(java, /private static boolean recordFix\(boolean moving\)/);
  assert.equal(java.includes('class LocationKeepServiceTest'), false);
});

test('a walk that starts after a long stay is sampled at 2.5s, and the 1.51 intervals fail that', () => {
  const current = policyFromJava(java);
  assert.equal(current.movingMs, 2_500);
  assert.equal(current.rideMs, 1_000);
  assert.equal(current.stillProbeMs, 30_000);
  assert.equal(current.stillMs, 60_000);
  assert.equal(current.stillLongMs, 60_000);
  assert.equal(current.stillMaxMs, 120_000);
  assert.ok(current.ambiguousMs >= 15_000 && current.ambiguousMs <= 30_000);
  assert.match(keepCopy, /걷는 동안은 2\.5초, 차나 자전거는 1초마다 기록합니다/);
  assert.match(keepCopy, /30초에서 1분마다 움직임만 확인/);
  assert.equal(keepCopy.includes('2분에서 5분으로 줄입니다'), false);
  assert.equal(current.sampleGapMs, 800);
  assert.ok(current.sampleGapMs < current.rideMs);

  const next = simulateLongStayWalk(current);
  const main = simulateLongStayWalk(POLICY_151);
  assert.equal(passesDenseWalkStart(next), true, JSON.stringify({
    ms: next.msToMoving,
    chord: Math.round(next.openingChordM),
    stay: next.stayPoints,
    gaps: next.movingGaps.slice(0, 4),
  }));
  assert.equal(passesDenseWalkStart(main), false);
  assert.ok(main.msToMoving >= 300_000, `1.51 waited ${main.msToMoving}ms`);
  assert.ok(main.openingChordM >= 300, `1.51 opening chord ${Math.round(main.openingChordM)}m`);
  assert.ok(main.stayPoints > 1, '1.51 stored the stay probes');

  let points = [];
  for (const fix of next.trail) points = settleTrailPoint(points, { ...fix, staying: fix.speedMps < 0.8 }, fix.at).points;
  const drawn = points.filter((point) => point && !point.stayEnd);
  const walked = drawn.filter((point) => point.at > next.walkStart);
  assert.equal(drawn.filter((point) => point.at <= next.walkStart).length, 1);
  assert.ok(walked.length >= next.trail.filter((point) => point.at > next.walkStart).length * 0.9);
  const parts = trailDrawParts(points);
  assert.equal(parts.some((part) => part.dashed), false);
  assert.ok(parts.some((part) => !part.dashed && part.points.length >= 10));
});

test('a quiet stay widens from 30s to 60s, and an unclear step uses the 20s bridge', () => {
  const policy = policyFromJava(java);
  const home = { lat: 37.55, lng: 127.05 };
  const still = replayFixes(policy, [
    { ...home, at: 0, speedMps: 0 },
    { ...home, at: 30_000, speedMps: 0 },
  ]);
  assert.equal(still.stayConfirmed, true);
  assert.equal(still.interval, 60_000);
  assert.equal(still.recorded, 1);
  const hint = replayFixes(policy, [
    { ...home, at: 0, speedMps: 0 },
    { ...eastOf(home.lat, home.lng, 5), at: 30_000, speedMps: 0.4 },
  ]);
  assert.equal(hint.moving, false);
  assert.equal(hint.interval, 20_000);
  assert.equal(hint.recorded, 1);
  const armed = replayFixes(policy, [
    { ...home, at: 0, speedMps: 0 },
    { ...home, at: 60_000, speedMps: 0 },
    { ...eastOf(home.lat, home.lng, 72), at: 120_000, speedMps: 1.2 },
  ]);
  assert.equal(armed.moving, true);
  assert.equal(armed.interval, 2_500);
  assert.equal(armed.recorded, 2);
});

test('1s ride samples and 2.5s walk samples stay in the stored trail', () => {
  const home = { lat: 37.55, lng: 127.02 };
  const t = 1_700_000_000_000;
  let ride = [{ ...home, at: t, accuracyM: 12, speedMps: 4.2, staying: false }];
  for (let index = 1; index <= 40; index += 1) {
    ride.push({
      ...eastOf(home.lat, home.lng, index * 4.2),
      at: t + index * 1_000,
      accuracyM: 12,
      speedMps: 4.2,
      staying: false,
    });
  }
  let stored = [ride[0]];
  for (const point of ride.slice(1)) stored = settleTrailPoint(stored, point, point.at).points;
  const keptRide = stored.filter((point) => !point.stayEnd);
  assert.ok(keptRide.length >= 38, `ride kept ${keptRide.length} of ${ride.length}`);

  let walk = [{ ...home, at: t, accuracyM: 12, speedMps: 1.2, staying: false }];
  for (let index = 1; index <= 40; index += 1) {
    walk.push({
      ...eastOf(home.lat, home.lng, index * 3),
      at: t + index * 2_500,
      accuracyM: 12,
      speedMps: 1.2,
      staying: false,
    });
  }
  stored = [walk[0]];
  for (const point of walk.slice(1)) stored = settleTrailPoint(stored, point, point.at).points;
  const keptWalk = stored.filter((point) => !point.stayEnd);
  assert.equal(keptWalk.length, walk.length);
  assert.equal(trailDrawParts(stored).some((part) => part.dashed), false);
});

test('stay probes that only jitter do not add trail vertices, and a real walk still leaves', () => {
  const home = { lat: 37.55, lng: 127.05 };
  const t = 1_700_000_000_000;
  let points = [];
  for (let index = 0; index < 20; index += 1) {
    const east = 3 * Math.sin(index);
    const at = t + index * 30_000;
    points = settleTrailPoint(points, {
      ...eastOf(home.lat, home.lng, east),
      at,
      speedMps: 0,
      accuracyM: 12,
      staying: true,
    }, at).points;
  }
  const before = points.filter((point) => !point.stayEnd);
  assert.equal(before.length, 1);
  let east = 0;
  let at = t + 20 * 30_000;
  for (let index = 1; index <= 24; index += 1) {
    east += 3;
    at += 2_500;
    points = settleTrailPoint(points, {
      ...eastOf(home.lat, home.lng, east),
      at,
      speedMps: 1.2,
      accuracyM: 8,
      staying: false,
    }, at).points;
  }
  const drawn = points.filter((point) => !point.stayEnd);
  assert.ok(drawn.length >= 20, `walk kept ${drawn.length}`);
  assert.equal(trailDrawParts(points).some((part) => part.dashed), false);
});
