import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { settleTrailPoint, trailDrawParts } from './tracking.mjs';
import { POLICY_151, acceptFix, eastOf, freshMotion, policyFromJava, replayFixes, simulateLongStayWalk } from './gpsKeepPolicy.mjs';
import { mergeNativeFixes } from './nativeTrail.mjs';

const java = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/LocationKeepService.java', import.meta.url), 'utf8');
const keepCopy = readFileSync(new URL('../components/family/FamilyMapScreen.tsx', import.meta.url), 'utf8');

function passesDenseWalkStart(result) {
  return result.msToMoving <= 30_000
    && result.openingChordM <= 30 * 1.2 + 1
    && result.stayPoints === 1
    && result.movingGaps.length >= 20
    && result.movingGaps.every((gap) => gap === 2_000);
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

test('a walk that starts after a long stay is sampled at 2s, and the 1.51 intervals fail that', () => {
  const current = policyFromJava(java);
  assert.equal(current.movingMs, 2_000);
  assert.equal(current.rideMs, 1_000);
  assert.equal(current.stillProbeMs, 20_000);
  assert.equal(current.stillMs, 20_000);
  assert.equal(current.stillLongMs, 20_000);
  assert.equal(current.stillMaxMs, 30_000);
  assert.ok(current.ambiguousMs >= 15_000 && current.ambiguousMs <= 30_000);
  assert.match(keepCopy, /걷는 동안은 2초, 차나 자전거는 1초마다 받습니다/);
  assert.match(keepCopy, /20초마다 움직임만 확인/);
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

test('an 800m catch-up inside 120s used to store no point and now stores it', () => {
  const policy = policyFromJava(java);
  assert.equal(policy.acceptAgeMs, 180_000);
  const home = { lat: 37.55, lng: 127.05 };
  const fixes = [];
  for (let step = 0; step <= 2; step += 1) {
    fixes.push({ ...home, at: step * 20_000, speedMps: 0, accuracyM: 12 });
  }
  fixes.push({ ...eastOf(home.lat, home.lng, 800), at: 60_000, speedMps: 0, accuracyM: 15 });
  const played = replayFixes(policy, fixes);
  assert.equal(played.moving, true);
  assert.ok(played.recorded >= 2, `recorded ${played.recorded}`);
  const implied = 800 / 20;
  const legacyWalk = implied <= 12;
  const legacyTrip = 20_000 > policy.walkPaceMaxMs;
  assert.equal(legacyWalk || legacyTrip, false);
  assert.match(java, /moved >= 50f && implied > 12f/);
  assert.match(java, /JOURNAL_CAP = 6_000/);
  assert.match(java, /trail-journal\.seal/);
  assert.match(java, /uploadedThrough/);
  assert.match(java, /NativeDiag.commitFile/);
  assert.equal(java.includes('dest.delete()'), false);
  assert.equal(java.includes('journal.remove(0);\n        }\n        if (upload.pin'), false);
});

test('a 45s-old walk batch is kept, and a 100m fix on the 20s stay probe is not the zero-point path', () => {
  const policy = policyFromJava(java);
  const home = { lat: 37.55, lng: 127.05 };
  const state = freshMotion(policy);
  const now = 120_000;
  const stale = acceptFix(state, policy, { ...eastOf(home.lat, home.lng, 40), at: now - 45_000, speedMps: 1.2, accuracyM: 15 }, now);
  assert.equal(stale.drop, null);
  assert.equal(stale.recorded, true);
  const ancient = acceptFix(freshMotion(policy), policy, { ...home, at: now - 200_000, speedMps: 0, accuracyM: 12 }, now);
  assert.equal(ancient.drop, 'stale');
  const precise = freshMotion(policy);
  acceptFix(precise, policy, { ...home, at: 0, speedMps: 0, accuracyM: 10 }, 0);
  const coarse = acceptFix(precise, policy, { ...eastOf(home.lat, home.lng, 24), at: 20_000, speedMps: 1.2, accuracyM: 100 }, 20_000);
  assert.equal(coarse.drop, null);
  assert.equal(coarse.recorded, true);
  const soon = acceptFix(precise, policy, { ...eastOf(home.lat, home.lng, 40), at: 30_000, speedMps: 1.2, accuracyM: 100 }, 30_000);
  assert.equal(soon.drop, 'accuracy');
  const diag = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/NativeDiag.java', import.meta.url), 'utf8');
  assert.equal(diag.includes('latitude'), false);
  assert.equal(diag.includes('put("lat"'), false);
  assert.match(diag, /row.has\("lat"\)/);
  assert.equal(diag.includes('getLatitude'), false);
  assert.match(diag, /24L \* 60L \* 60L \* 1000L/);
  const merged = mergeNativeFixes(
    [{ lat: home.lat, lng: home.lng, at: 1_000, accuracyM: 8, speedMps: 0 }],
    [
      { lat: home.lat, lng: home.lng, at: 1_000, accuracyM: 8, speedMps: 0 },
      { ...eastOf(home.lat, home.lng, 30), at: 20_000, accuracyM: 8, speedMps: 1.4 },
    ],
  );
  assert.ok(merged.length >= 2);
  assert.equal(mergeNativeFixes(merged, [{ ...eastOf(home.lat, home.lng, 30), at: 20_000, accuracyM: 8, speedMps: 1.4 }]), merged);
  const late = { ...eastOf(home.lat, home.lng, 80), at: 80_000, accuracyM: 8, speedMps: 1.4 };
  const early = { ...eastOf(home.lat, home.lng, 40), at: 40_000, accuracyM: 8, speedMps: 1.4 };
  const stay = { lat: home.lat, lng: home.lng, at: 5_000, stayEnd: true, speedMps: 0, accuracyM: 8 };
  const further = { ...eastOf(home.lat, home.lng, 130), at: 110_000, accuracyM: 8, speedMps: 1.4 };
  const appended = mergeNativeFixes([stay, late], [further]);
  assert.equal(appended.includes(stay), true);
  assert.equal(appended.includes(late), true);
  assert.ok(appended.some((point) => point.at === 110_000));
  assert.equal(mergeNativeFixes(appended, [further]), appended);
  const ordered = mergeNativeFixes([stay, late], [early]);
  const times = ordered.map((point) => point.at);
  assert.deepEqual(times, [...times].sort((left, right) => left - right));
  assert.ok(times.includes(40_000));
  assert.equal(ordered.includes(stay), true);
  const spike = { ...eastOf(home.lat, home.lng, 25), at: 4_000, accuracyM: 30, speedMps: 0 };
  const base = [{ ...home, at: 1_000, accuracyM: 8, speedMps: 0 }];
  assert.equal(mergeNativeFixes(base, [spike]), base);
  const live = [{ ...home, at: 60_000, accuracyM: 8, speedMps: 0 }];
  const archived = mergeNativeFixes(live, [early], [{ startedAt: 0, endedAt: 60_000 }]);
  assert.equal(archived, live);
  const outing = [0, 40, 80, 120, 160].map((sec, index) => ({
    ...eastOf(home.lat, home.lng, index * 30),
    at: sec * 1000,
    accuracyM: 8,
    speedMps: 0,
  }));
  const marker = { ...outing[0], at: 35_000, stayEnd: true, speedMps: 0 };
  outing.splice(1, 0, marker);
  const probe = { ...eastOf(home.lat, home.lng, 8), at: 20_000, accuracyM: 10, speedMps: 0 };
  const kept = mergeNativeFixes(outing, [probe]);
  assert.equal(kept.length, outing.length);
  for (const point of outing) assert.equal(kept.includes(point), true);
  const reader = diag.slice(diag.indexOf('static String readCommitted'), diag.indexOf('private static String readArray'));
  assert.ok(reader.indexOf('.tmp') >= 0 && reader.indexOf('.tmp') < reader.indexOf('.bak'));
});

test('a quiet stay stays at 20s, and an unclear step uses the 15s bridge', () => {
  const policy = policyFromJava(java);
  const home = { lat: 37.55, lng: 127.05 };
  const still = replayFixes(policy, [
    { ...home, at: 0, speedMps: 0 },
    { ...home, at: 20_000, speedMps: 0 },
  ]);
  assert.equal(still.stayConfirmed, true);
  assert.equal(still.interval, 20_000);
  assert.equal(still.recorded, 1);
  const hint = replayFixes(policy, [
    { ...home, at: 0, speedMps: 0 },
    { ...eastOf(home.lat, home.lng, 5), at: 10_000, speedMps: 0.4 },
  ]);
  assert.equal(hint.moving, false);
  assert.equal(hint.interval, 15_000);
  assert.equal(hint.recorded, 1);
  const armed = replayFixes(policy, [
    { ...home, at: 0, speedMps: 0 },
    { ...home, at: 20_000, speedMps: 0 },
    { ...eastOf(home.lat, home.lng, 24), at: 40_000, speedMps: 1.2 },
  ]);
  assert.equal(armed.moving, true);
  assert.equal(armed.interval, 2_000);
  assert.equal(armed.recorded, 2);
  const noisy = replayFixes(policy, [
    { ...home, at: 0, speedMps: 0 },
    { ...home, at: 20_000, speedMps: 0 },
    { ...eastOf(home.lat, home.lng, 2), at: 8 * 60_000, speedMps: 0.6 },
  ]);
  assert.equal(noisy.stayConfirmed, true);
  assert.equal(noisy.interval, 20_000);
  assert.equal(noisy.moving, false);
  assert.ok(noisy.interval <= 30_000);
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
      at: t + index * 2_000,
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
