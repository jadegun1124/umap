import assert from 'node:assert/strict';
import test from 'node:test';
import { settleTrailPoint, trailDecision, trailDrawParts } from './tracking.mjs';

function east(lat, lng, meters) {
  return { lat, lng: lng + meters / (111320 * Math.cos((lat * Math.PI) / 180)) };
}

function straightWalk({ speedMps, staying, count = 40, stepM = 1, stepMs = 1000 }) {
  const t = Date.parse('2026-11-01T09:40:00Z');
  const points = [];
  for (let index = 0; index < count; index += 1) {
    points.push({
      ...east(37.6372, 127.07085, index * stepM),
      at: t + index * stepMs,
      accuracyM: 8,
      speedMps,
      staying,
    });
  }
  return points;
}

function settle(samples) {
  let points = [];
  for (const sample of samples) points = settleTrailPoint(points, sample, sample.at).points;
  return points.filter((point) => point && !point.stayEnd);
}

test('speed 0 and missing speed stay dense when the ground pace is a walk', () => {
  const origin = { lat: 37.6372, lng: 127.07085, at: 1_700_000_000_000, accuracyM: 8, speedMps: 0, staying: true };
  const step = { ...east(origin.lat, origin.lng, 1), at: origin.at + 1000, accuracyM: 8, speedMps: 0, staying: true };
  assert.equal(trailDecision(origin, step), 'keep');
  const missing = { ...step, speedMps: null, staying: false };
  assert.equal(trailDecision(origin, missing), 'keep');
  const hop = { ...east(origin.lat, origin.lng, 20), at: origin.at + 2000, accuracyM: 8, speedMps: 0, staying: true };
  assert.equal(trailDecision(origin, hop), 'snap');
  for (const speedMps of [0, null]) {
    const stored = settle(straightWalk({ speedMps, staying: speedMps === 0 }));
    assert.ok(stored.length >= 36, `stored ${stored.length} for speed ${speedMps}`);
  }
});

test('drawing does not Douglas-Peucker a straight walking line', () => {
  const samples = straightWalk({ speedMps: 1.1, staying: false, count: 40, stepM: 1, stepMs: 1000 });
  const stored = settle(samples);
  const drawn = trailDrawParts(stored).flatMap((part) => part.points);
  let near = 0;
  for (const sample of stored) {
    const close = drawn.some((point) => {
      const north = (point.lat - sample.lat) * 110540;
      const east = (point.lng - sample.lng) * 111320 * Math.cos((sample.lat * Math.PI) / 180);
      return Math.hypot(north, east) <= 0.2;
    });
    if (close) near += 1;
  }
  assert.ok(near >= stored.length * 0.9, `drawn vertices cover ${near} of ${stored.length}`);
  assert.equal(trailDrawParts(stored).some((part) => part.dashed), false);
});
