import assert from 'node:assert/strict';
import test from 'node:test';
import { displayLivePoints, liveMotionLabel, settleTrailPoint } from './tracking.mjs';

// North/east meters from the first accepted fix in diag vvHVqgjSWk1NJtj2zjYCTuJw.
// The report had no stored polyline. These are the new fixes while the line was already on screen.
const STILL_METERS = [
  [0, 0, 11.9],
  [-0.1, 0.1, 20.6],
  [-1, -0.7, 12.1],
  [-0.1, -1.1, 12.4],
  [0, -1.6, 20.6],
  [0.3, -1.3, 8.9],
  [0.6, -1.2, 6.5],
  [0.6, -1.4, 5.4],
  [0.6, -1.3, 4.7],
  [0.6, -1.2, 4.3],
  [0.4, -1.3, 3.9],
  [0.6, -1.2, 3.7],
  [0.6, -1.2, 3.6],
  [0.6, -1.1, 3.5],
  [0.6, -1.2, 3.3],
  [0.6, -1.2, 3.2],
  [0.4, -1.5, 12],
  [0.4, -1.3, 20.5],
  [0.7, -1.8, 8.8],
  [0.8, -2.1, 6.6],
  [0.6, -2.1, 5.5],
  [0.4, -1.9, 4.7],
  [1.9, -4.8, 25.3],
  [1.2, -2.6, 8.6],
  [0, -2.1, 142],
];

function at(lat, lng, north, east, time) {
  return {
    lat: lat + north / 111_320,
    lng: lng + east / (111_320 * Math.cos((lat * Math.PI) / 180)),
    at: time,
  };
}

test('the still fixes from the 15:20 diag do not extend a line and an older indoor loop clears', () => {
  const origin = { lat: 37.5, lng: 127 };
  const t0 = Date.UTC(2026, 10, 1, 5, 26, 0);
  const spread = Math.max(...STILL_METERS.map(([north, east]) => Math.hypot(north, east)));
  assert.ok(spread < 6, `still cluster ${spread.toFixed(1)}m`);

  let points = [];
  STILL_METERS.forEach(([north, east, accuracy], index) => {
    const sample = {
      ...at(origin.lat, origin.lng, north, east, t0 + index * 8_000),
      accuracyM: accuracy,
      speedMps: 0,
      staying: true,
    };
    const settled = settleTrailPoint(points, sample, sample.at);
    if (points.length && accuracy <= 40) assert.equal(settled.decision, 'snap', `fix ${index} was ${settled.decision}`);
    points = settled.points;
  });
  assert.ok(points.filter((point) => !point.stayEnd).length <= 1);

  const loopStart = t0 - 20 * 60_000;
  const loop = [];
  for (let index = 0; index < 32; index += 1) {
    loop.push({
      ...at(origin.lat, origin.lng, index % 4 < 2 ? 0 : 40, index % 2 === 0 ? 0 : 80, loopStart + index * 12_000),
      accuracyM: 12,
      speedMps: 0,
      staying: true,
    });
  }
  const now = loopStart + 32 * 12_000 + 8 * 60_000;
  assert.equal(liveMotionLabel({
    located: true,
    moving: false,
    points: loop,
    now,
    pin: { ...loop[loop.length - 1], at: now, speedMps: 0, staying: true },
  }), '머무름');
  assert.equal(displayLivePoints(loop, now).length, 0);
  let kept = loop.slice();
  for (const [north, east, accuracy] of STILL_METERS) {
    if (accuracy > 40) continue;
    const sample = { ...at(origin.lat, origin.lng, north, east, now), accuracyM: accuracy, speedMps: 0, staying: true };
    kept = settleTrailPoint(kept, sample, sample.at).points;
  }
  assert.equal(displayLivePoints(kept, now).length, 0);
});
