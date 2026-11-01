import assert from 'node:assert/strict';
import test from 'node:test';
import { carryPlace } from './memberPlace.mjs';
import { appendLiveTip, buildDayRecord, displayLivePoints, liveMotionLabel, mergeVisitStops, previewOpenJourney, settleTrailPoint, storedTrackAfterArchive, trailDrawParts, walkLeavesStay } from './tracking.mjs';
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

test('a 100m store run inside 300m is a short journey and splits the home visit', () => {
  const home = { lat: 37.55, lng: 127.05, place: '옛아파트' };
  const t0 = Date.parse('2026-11-01T09:00:00Z');
  const fixes = [];
  for (let minute = 0; minute < 8; minute += 1) {
    fixes.push({ ...home, at: t0 + minute * 60_000, speedMps: 0, accuracyM: 12, staying: true });
  }
  const leave = t0 + 8 * 60_000;
  const stepM = 1.2 * 8;
  const outSteps = Math.ceil(100 / stepM);
  for (let index = 1; index <= outSteps; index += 1) {
    const east = Math.min(100, index * stepM);
    fixes.push({ ...eastOf(home.lat, home.lng, east), at: leave + index * 8_000, speedMps: null, accuracyM: 8, staying: true });
  }
  let at = fixes[fixes.length - 1].at;
  let east = 100;
  while (east > 0) {
    east = Math.max(0, east - stepM);
    at += 8_000;
    fixes.push({ ...eastOf(home.lat, home.lng, east), at, speedMps: null, accuracyM: 8, staying: true });
  }
  const back = fixes[fixes.length - 1].at;
  for (let minute = 1; minute <= 8; minute += 1) {
    fixes.push({ ...home, at: back + minute * 60_000, speedMps: 0, accuracyM: 12, staying: true });
  }
  let points = [];
  let journeys = [];
  let visits = [];
  let sawMoving = false;
  let relabeled = false;
  let solidWalk = false;
  for (const fix of fixes) {
    const before = points;
    const directed = walkLeavesStay(before, fix);
    points = settleTrailPoint(before, fix, fix.at).points;
    const archived = storedTrackAfterArchive(points, fix.at);
    if (archived.journeys.length > 0) {
      journeys = journeys.concat(archived.journeys);
      points = archived.points;
    }
    visits = mergeVisitStops(visits, buildDayRecord(points, fix.at).stops, fix.at);
    const east = meters(home, fix);
    if (fix.at - leave <= 90_000 && fix.at > leave && liveMotionLabel({ located: true, moving: false, points, now: fix.at, pin: fix }) === '지금') {
      sawMoving = true;
    }
    if (east >= 50 && east <= 120 && directed && carryPlace({ ...home, placeLat: home.lat, placeLng: home.lng }, fix.lat, fix.lng, { directed, accuracyM: 8 }) === '') {
      relabeled = true;
    }
    const live = displayLivePoints(points, fix.at);
    const parts = trailDrawParts(live.length >= 2 ? live : points);
    if (east >= 40 && east <= 120 && parts.some((part) => !part.dashed && chord(part) >= 40)) solidWalk = true;
    if (parts.some((part) => part.dashed && chord(part) >= 120)) solidWalk = false;
  }
  const now = fixes[fixes.length - 1].at;
  const open = previewOpenJourney(points, now);
  const cards = journeys.concat(open ? [open] : []);
  const trip = cards.filter((journey) => journey.distanceM >= 80 && (journey.endedAt - journey.startedAt) < 30 * 60 * 1000);
  const stops = visits;
  const homeStops = stops.filter((stop) => meters(home, stop) < 50);
  assert.equal(sawMoving, true);
  assert.equal(relabeled, true);
  assert.equal(solidWalk, true);
  assert.ok(trip.length >= 1, `journeys ${cards.map((journey) => `${journey.distanceM}m/${Math.round((journey.endedAt - journey.startedAt) / 1000)}s`).join(',')}`);
  assert.ok(stops.length >= 2 && (homeStops.length >= 2 || stops.some((stop) => meters(home, stop) >= 50)), `stops ${stops.length} home ${homeStops.length}`);
  assert.equal(cards.some((journey) => (journey.endedAt - journey.startedAt) > 30 * 60 * 1000), false);
});

test('a dense 2.5s store run inside 300m is still a short journey', () => {
  const home = { lat: 37.55, lng: 127.05 };
  const t0 = Date.parse('2026-11-01T10:00:00Z');
  const fixes = [];
  for (let minute = 0; minute < 8; minute += 1) {
    fixes.push({ ...home, at: t0 + minute * 60_000, speedMps: 0, accuracyM: 8, staying: true });
  }
  let at = t0 + 8 * 60_000;
  const stepM = 1.25 * 2.5;
  let east = 0;
  while (east < 100) {
    east = Math.min(100, east + stepM);
    at += 2_500;
    fixes.push({ ...eastOf(home.lat, home.lng, east), at, speedMps: null, accuracyM: 8, staying: false });
  }
  while (east > 0) {
    east = Math.max(0, east - stepM);
    at += 2_500;
    fixes.push({ ...eastOf(home.lat, home.lng, east), at, speedMps: null, accuracyM: 8, staying: false });
  }
  const back = at;
  for (let minute = 1; minute <= 8; minute += 1) {
    fixes.push({ ...home, at: back + minute * 60_000, speedMps: 0, accuracyM: 8, staying: true });
  }
  let points = [];
  let journeys = [];
  let visits = [];
  for (const fix of fixes) {
    points = settleTrailPoint(points, fix, fix.at).points;
    const archived = storedTrackAfterArchive(points, fix.at);
    if (archived.journeys.length > 0) {
      journeys = journeys.concat(archived.journeys);
      points = archived.points;
    }
    visits = mergeVisitStops(visits, buildDayRecord(points, fix.at).stops, fix.at);
  }
  const trip = journeys.filter((journey) => journey.distanceM >= 80 && (journey.endedAt - journey.startedAt) < 30 * 60 * 1000);
  assert.ok(trip.length >= 1, `journeys ${journeys.map((journey) => journey.distanceM).join(',')}`);
  assert.ok(visits.length >= 2, `visits ${visits.length}`);
});

test('a walked pace onto the live pin stays solid', () => {
  const start = { lat: 37.55, lng: 127.05, at: 1_000, accuracyM: 8, staying: true };
  const mid = { ...eastOf(start.lat, start.lng, 20), at: 16_000, accuracyM: 8, staying: true };
  const tip = { ...eastOf(start.lat, start.lng, 75), at: 50_000, accuracyM: 8, staying: true };
  const parts = appendLiveTip([{ points: [start, mid], dashed: false }], tip);
  assert.equal(parts.some((part) => part.dashed), false);
  assert.ok(parts.some((part) => part.points.length >= 3));
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
