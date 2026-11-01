import assert from 'node:assert/strict';
import test from 'node:test';
import { carryPlace } from './memberPlace.mjs';
import { displayLivePoints, liveMotionLabel, settleTrailPoint, storedTrackAfterArchive, trailDrawParts, walkLeavesStay } from './tracking.mjs';
import { spreadPinPositions } from './mapPinSpread.mjs';

function eastOf(lat, lng, metersEast) {
  return { lat, lng: lng + metersEast / (111320 * Math.cos((lat * Math.PI) / 180)) };
}

function meters(a, b) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function chord(part) {
  const start = part.points[0];
  const end = part.points[part.points.length - 1];
  return start && end ? meters(start, end) : 0;
}

test('a 300m accurate walk leaves the stay within a minute, relabels, and draws solid', () => {
  const home = { lat: 37.55, lng: 127.05, place: '옛아파트' };
  const t0 = Date.parse('2026-11-01T09:30:00Z');
  let points = [];
  for (let index = 0; index < 6; index += 1) {
    const at = t0 + index * 60_000;
    points = settleTrailPoint(points, { ...home, at, speedMps: 0, accuracyM: 12, staying: true }, at).points;
  }
  const leave = t0 + 6 * 60_000;
  let sawMoving = false;
  let relabeled = false;
  let solidWalk = false;
  let before = points;
  for (let index = 1; index <= 32; index += 1) {
    const at = leave + index * 8_000;
    const east = Math.min(300, index * 1.2 * 8);
    const pos = eastOf(home.lat, home.lng, east);
    const sample = { ...pos, at, speedMps: null, accuracyM: 8, staying: true };
    const directed = walkLeavesStay(before, sample);
    points = settleTrailPoint(before, sample, at).points;
    const archived = storedTrackAfterArchive(points, at);
    if (archived.journeys.length > 0) points = archived.points;
    const motion = liveMotionLabel({ located: true, moving: false, points, now: at, pin: sample });
    if (at - leave <= 60_000 && motion === '지금') sawMoving = true;
    if (east >= 50 && directed && carryPlace({ ...home, placeLat: home.lat, placeLng: home.lng }, pos.lat, pos.lng, { directed, accuracyM: 8 }) === '') {
      relabeled = true;
    }
    const live = displayLivePoints(points, at);
    const parts = trailDrawParts(live.length >= 2 ? live : points);
    if (parts.some((part) => !part.dashed && chord(part) >= 40)) solidWalk = true;
    if (parts.some((part) => part.dashed && chord(part) >= 120)) solidWalk = false;
    before = points;
  }
  assert.equal(sawMoving, true);
  assert.equal(relabeled, true);
  assert.equal(solidWalk, true);
});

test('three bubbles at one spot stay apart on screen', () => {
  const members = [
    { id: 'mom', lat: 37.6372, lng: 127.07085 },
    { id: 'khoon', lat: 37.6372, lng: 127.07085 },
    { id: 'self', lat: 37.6372, lng: 127.0709 },
  ];
  const placed = spreadPinPositions(members);
  const slots = [...placed.values()];
  assert.equal(slots.length, 3);
  const xs = slots.map((slot) => slot.dx || 0);
  const ys = slots.map((slot) => slot.dy || 0);
  assert.ok(Math.max(...xs) - Math.min(...xs) >= 180, `dx ${xs.join(',')}`);
  assert.ok(new Set(ys).size >= 2 || Math.max(...xs) - Math.min(...xs) >= 240);
  assert.equal(placed.get('mom').lat, members[0].lat);
});
