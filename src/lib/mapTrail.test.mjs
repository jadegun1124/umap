import assert from 'node:assert/strict';
import test from 'node:test';
import { familyMapShowsTrail, memberLiveLines, mainOverviewTrails, recordsDayTrails, screenMapTrails } from './mapTrail.mjs';
import { liveTrailDrawable, liveTrailPoints, settleTrailPoint, trailDrawParts, trailSegmentDashed, WALK_STAY_LABEL_MS } from './tracking.mjs';
import { settleTrailPoint as settle112, trailDrawParts as draw112 } from './tracking112.fixture.mjs';

const self = { id: 'self', share: 'allowed', role: 'self' };
const peer = { id: 'admin', share: 'allowed', role: 'admin-share' };
const pending = { id: 'm2', share: 'pending', role: 'child' };
const journey = {
  points: [
    { lat: 37.5, lng: 127, at: 1 },
    { lat: 37.51, lng: 127.01, at: 2 },
  ],
};
const live = [
  { lat: 37.52, lng: 127.02, at: 3 },
  { lat: 37.53, lng: 127.03, at: 4 },
];

test('family overview draws a live trail only while that segment is still open', () => {
  assert.equal(familyMapShowsTrail({ viewingRecords: false, detailOpen: false, showTrail: true, member: self, liveDrawable: true }), true);
  assert.equal(familyMapShowsTrail({ viewingRecords: false, detailOpen: false, showTrail: false, member: peer, liveDrawable: true }), true);
  assert.equal(familyMapShowsTrail({ viewingRecords: false, detailOpen: false, showTrail: true, member: self, liveDrawable: false }), false);
  assert.equal(familyMapShowsTrail({ viewingRecords: false, detailOpen: false, showTrail: true, member: null, liveDrawable: true }), false);
});

test('closing records keeps a trail that is still live and hides one that was archived', () => {
  assert.equal(familyMapShowsTrail({ viewingRecords: false, detailOpen: true, showTrail: true, member: self, liveDrawable: true }), true);
  assert.equal(familyMapShowsTrail({ viewingRecords: false, detailOpen: true, showTrail: true, member: self, liveDrawable: false }), false);
});

test('the records list does not build a map line for every journey', () => {
  const saved = Array.from({ length: 40 }, (_, index) => ({ lat: 37.5, lng: 127 + index * 0.01 }));
  const detail = [{ lat: 37.1, lng: 127.1 }, { lat: 37.2, lng: 127.2 }];
  const live = [[{ lat: 37.4, lng: 127.4 }, { lat: 37.41, lng: 127.41 }]];
  assert.deepEqual(screenMapTrails({ viewingRecords: true, detailOpen: false, detailPoints: saved, liveLines: live }), []);
  assert.deepEqual(screenMapTrails({ viewingRecords: true, detailOpen: true, detailPoints: detail, liveLines: live }), [detail]);
  assert.equal(screenMapTrails({ viewingRecords: true, detailOpen: true, detailPoints: [detail[0]], liveLines: live }).length, 0);
  assert.equal(screenMapTrails({ viewingRecords: false, detailOpen: false, detailPoints: detail, liveLines: live }), live);
  assert.equal(saved.length, 40);
});

test('records view still draws that person trail', () => {
  assert.equal(familyMapShowsTrail({ viewingRecords: true, detailOpen: false, showTrail: true, member: self }), true);
  assert.equal(familyMapShowsTrail({ viewingRecords: true, detailOpen: false, showTrail: true, member: peer }), true);
  assert.equal(familyMapShowsTrail({ viewingRecords: true, detailOpen: false, showTrail: false, member: self }), false);
  assert.equal(familyMapShowsTrail({ viewingRecords: true, detailOpen: false, showTrail: true, member: pending }), false);
});

test('journey replay still draws while records are open', () => {
  assert.equal(familyMapShowsTrail({ viewingRecords: true, detailOpen: true, showTrail: false, member: self }), true);
});

function offset(point, northM, eastM, at) {
  return {
    ...point,
    lat: point.lat + northM / 111_320,
    lng: point.lng + eastM / (111_320 * Math.cos((point.lat * Math.PI) / 180)),
    at,
  };
}

function walkCurve(now) {
  const origin = { lat: 37.55, lng: 127.07, at: now - 40_000, accuracyM: 10, speedMps: 1.3, staying: false };
  const points = [];
  for (let index = 0; index <= 16; index += 1) {
    const theta = (Math.PI / 2) * (index / 16);
    points.push({
      ...offset(origin, 36 * Math.sin(theta), 36 * (1 - Math.cos(theta)), origin.at + index * 2_500),
      accuracyM: 10,
      speedMps: 1.3,
      staying: false,
    });
  }
  return points;
}

test('a finished walk still draws after the card would say 머무름', () => {
  const now = Date.UTC(2026, 9, 28, 3, 46);
  const walked = walkCurve(now - WALK_STAY_LABEL_MS - 5_000);
  const end = walked[walked.length - 1];
  assert.equal(liveTrailDrawable(walked, end.at + 2 * 60 * 1000), true);
  const stayed = mainOverviewTrails({
    points: walked,
    pin: { lat: end.lat, lng: end.lng, at: end.at },
    moving: false,
    now: end.at + WALK_STAY_LABEL_MS,
  });
  assert.equal(stayed.length, 1);
  assert.ok(stayed[0].length >= walked.length);

  const hole = [
    { lat: 37.6366, lng: 127.0672, at: now - 89 * 60 * 1000, accuracyM: 18, speedMps: 0, staying: true },
    { lat: 37.6378, lng: 127.0684, at: now - 60_000, accuracyM: 18, speedMps: 0, staying: true },
  ];
  const drawnHole = mainOverviewTrails({
    points: hole,
    pin: { lat: hole[1].lat, lng: hole[1].lng, at: hole[1].at },
    moving: false,
    now,
  });
  assert.equal(drawnHole.length, 1);
  assert.equal(drawnHole[0].length, 2);
  assert.equal(trailSegmentDashed(hole[0], hole[1]), true);
  assert.equal(trailDrawParts(drawnHole[0]).some((part) => part.dashed), false);
});

test('the overview keeps a walked hole and ends on a later pin', () => {
  const now = Date.UTC(2026, 9, 28, 4, 0);
  const walked = walkCurve(now);
  const end = walked[walked.length - 1];
  const hole = {
    ...offset(end, 0, 180, end.at + 80_000),
    accuracyM: 12,
    speedMps: 0,
    staying: true,
  };
  const shared = mainOverviewTrails({
    points: [...walked, hole],
    pin: { lat: end.lat, lng: end.lng, at: end.at },
    withPin: false,
  });
  assert.equal(shared.length, 1);
  assert.equal(shared[0].some((point) => point.lat === hole.lat && point.lng === hole.lng), true);
  assert.equal(trailDrawParts(shared[0]).some((part) => part.dashed), false);
  const pin = offset(hole, 12, -6, hole.at + 4_000);
  const lines = mainOverviewTrails({
    points: [...walked, hole],
    pin: { lat: pin.lat, lng: pin.lng, at: pin.at, speedMps: 1.2, staying: false },
    moving: false,
    now: pin.at + 1_000,
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0][lines[0].length - 1].lat, pin.lat);
  assert.equal(lines[0][lines[0].length - 1].lng, pin.lng);
  assert.deepEqual(lines[0].slice(0, -1).map((point) => point.lat), shared[0].map((point) => point.lat));
  const jumpedPin = offset(end, 0, 400, end.at + 6_000);
  const jumped = mainOverviewTrails({
    points: walked,
    pin: { ...jumpedPin, speedMps: 0 },
    moving: false,
    now: end.at + 2_000,
  });
  assert.equal(jumped.length, 1);
  assert.equal(jumped[0][jumped[0].length - 1].lat, end.lat);
  assert.equal(jumped[0].some((point) => point.lat === jumpedPin.lat && point.lng === jumpedPin.lng), false);
});

test('a gps hole stays on the shared line and the next step still ends on the pin', () => {
  const now = Date.UTC(2026, 9, 28, 4, 10);
  const walked = walkCurve(now);
  const end = walked[walked.length - 1];
  const hole = {
    ...offset(end, 0, 90, end.at + 25_000),
    accuracyM: 12,
    speedMps: 1.2,
    staying: false,
  };
  assert.equal(trailSegmentDashed(end, hole), true);
  const during = mainOverviewTrails({
    points: [...walked, hole],
    pin: { lat: hole.lat, lng: hole.lng, at: hole.at, speedMps: hole.speedMps },
    moving: null,
    now: hole.at + 1_000,
  });
  assert.equal(during.length, 1);
  assert.ok(during[0].length >= walked.length);
  assert.equal(during[0].some((point) => point.lat === hole.lat && point.lng === hole.lng), true);
  const resume = offset(hole, 0, 8, hole.at + 3_000);
  const after = mainOverviewTrails({
    points: [...walked, hole, { ...resume, accuracyM: 10, speedMps: 1.3, staying: false }],
    pin: { lat: resume.lat, lng: resume.lng, at: resume.at },
    moving: null,
    now: resume.at + 1_000,
  });
  assert.ok(after.length >= 1);
  assert.equal(after[0][after[0].length - 1].lat, resume.lat);
  assert.equal(after[0].some((point) => point.lat === hole.lat), true);
});

function eastOf(lat, lng, meters) {
  return lng + meters / (111_320 * Math.cos((lat * Math.PI) / 180));
}

function segmentMeters(start, end) {
  const radius = 6_371_000;
  const p1 = (start.lat * Math.PI) / 180;
  const p2 = (end.lat * Math.PI) / 180;
  const dLat = p2 - p1;
  const dLng = ((end.lng - start.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Walk east. Accuracy cycles through 15–150m the way a phone alternates GPS and network.
 * Self fixes carry a walking speed. Family places are only lat, lng, time, and accuracy.
 */
function ingestMixedWalk(kind) {
  const accuracies = [15, 80, 120, 150];
  const lat = 37.6652;
  let lng = 127.0472;
  let points = [];
  let pin = null;
  const start = Date.UTC(2026, 9, 31, 3, 40, 0);
  const stepM = 12;
  const dt = 8_000;
  for (let index = 0; index < 40; index += 1) {
    const at = start + index * dt;
    const sample = {
      lat,
      lng,
      at,
      accuracyM: accuracies[index % accuracies.length],
      ...(kind === 'self' ? { speedMps: 1.3, staying: false } : {}),
    };
    const settled = settleTrailPoint(points, sample, at);
    points = settled.points;
    pin = {
      lat: Number.isFinite(settled.lat) ? settled.lat : sample.lat,
      lng: Number.isFinite(settled.lng) ? settled.lng : sample.lng,
      at,
      accuracyM: sample.accuracyM,
      ...(kind === 'self' ? { speedMps: 1.3 } : {}),
    };
    lng = eastOf(lat, lng, stepM);
  }
  const now = start + 39 * dt + 500;
  const live = liveTrailPoints(points, now);
  const lines = mainOverviewTrails({
    points: live,
    motionPoints: points,
    pin,
    moving: kind === 'self' ? true : null,
    now,
  });
  const solid = lines.flatMap((line) => trailDrawParts(line).filter((part) => !part.dashed && part.points.length >= 2));
  const span = solid.reduce((sum, part) => sum + segmentMeters(part.points[0], part.points[part.points.length - 1]), 0);
  return { points, live, lines, solid, span };
}

test('a mixed 15–150m walk draws a main-map line for self and for a family member', () => {
  for (const kind of ['self', 'family']) {
    const drawn = ingestMixedWalk(kind);
    assert.ok(drawn.live.length >= 2, `${kind} live vertices ${drawn.live.length}`);
    assert.ok(drawn.lines.length >= 1, `${kind} overview lines ${drawn.lines.length}`);
    assert.ok(drawn.solid.length >= 1, `${kind} solid parts ${drawn.solid.length}`);
    assert.ok(drawn.span >= 200, `${kind} solid span ${Math.round(drawn.span)}m`);
  }
  const self = ingestMixedWalk('self');
  assert.ok(self.points.filter((point) => point && !point.stayEnd).length >= 2);
});

test('a gps walk then network fixes still ends on the live pin for self and a family member', () => {
  function north(lat, meters) {
    return lat + meters / 111_320;
  }
  function gap(line, pin) {
    const tip = line[line.length - 1];
    const radius = 6_371_000;
    const p1 = (tip.lat * Math.PI) / 180;
    const p2 = (pin.lat * Math.PI) / 180;
    const dLat = p2 - p1;
    const dLng = ((pin.lng - tip.lng) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
    return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  const accuracies = [60, 90, 120, 150, 80];
  function stream(kind) {
    const t0 = Date.UTC(2026, 9, 31, 5, 40, 0);
    let lat = 37.578;
    const lng = 127.032;
    let points = [];
    for (let index = 0; index < 36; index += 1) {
      const sample = { lat, lng, at: t0 + index * 2_500, accuracyM: 12, speedMps: 1.4, staying: false };
      points = settleTrailPoint(points, sample, sample.at).points;
      lat = north(lat, 3.5);
    }
    const networkAt = t0 + 36 * 2_500;
    for (let index = 0; index < 30; index += 1) {
      const sample = {
        lat,
        lng,
        at: networkAt + index * 8_000,
        accuracyM: accuracies[index % accuracies.length],
        ...(kind === 'self' ? { speedMps: 0, staying: true } : {}),
      };
      const settled = settleTrailPoint(points, sample, sample.at);
      points = settled.points;
      lat = north(lat, 12);
    }
    const at = networkAt + 29 * 8_000;
    const member = {
      id: kind,
      role: kind === 'self' ? 'self' : 'admin-share',
      share: 'allowed',
      lat,
      lng,
      updatedAt: at,
      accuracyM: 120,
      moving: kind === 'self' ? false : null,
    };
    return { member, points, now: at + 500 };
  }
  for (const kind of ['self', 'family']) {
    const { member, points, now } = stream(kind);
    const drawn = memberLiveLines(member, { [kind]: points }, now);
    assert.equal(drawn.reason, 'draw', `${kind} ${drawn.reason}`);
    const line = drawn.lines[drawn.lines.length - 1];
    assert.ok(line && line.length >= 2, kind);
    assert.ok(gap(line, member) < 20, `${kind} pin gap ${line ? Math.round(gap(line, member)) : 'none'}`);
  }
});

function paintParts(parts) {
  return parts
    .filter((part) => part.points.length >= 2)
    .map((part) => `${part.dashed ? 'd' : 's'}:${part.points.map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join(' ')}`)
    .join('|');
}

/** GPS-quality walk: dense curve, a 300m gap, then a quiet sensor that is still moving. */
function referenceWalk() {
  const origin = { lat: 37.6368, lng: 127.0674, at: Date.UTC(2026, 9, 31, 3, 49, 0) };
  const fixes = [];
  for (let index = 0; index <= 20; index += 1) {
    const theta = (Math.PI / 2) * (index / 20);
    fixes.push({
      ...offset(origin, 48 * Math.sin(theta), 48 * (1 - Math.cos(theta)), origin.at + index * 2_500),
      accuracyM: 12,
      speedMps: 1.3,
      staying: false,
    });
  }
  const tip = fixes[fixes.length - 1];
  fixes.push({
    ...offset(tip, 300, 0, tip.at + 90_000),
    accuracyM: 12,
    speedMps: 0,
    staying: true,
  });
  const afterGap = fixes[fixes.length - 1];
  for (let index = 1; index <= 6; index += 1) {
    fixes.push({
      ...offset(afterGap, 0, index * 25, afterGap.at + index * 18_000),
      accuracyM: 12,
      speedMps: 0,
      staying: true,
    });
  }
  return fixes;
}

test('a 1.12-quality walk draws the same polyline as the 1.12 pipeline', () => {
  const fixes = referenceWalk();
  let current = [];
  let previous = [];
  for (const fix of fixes) {
    current = settleTrailPoint(current, fix, fix.at).points;
    previous = settle112(previous, fix, fix.at).points;
  }
  const gap = fixes.find((fix) => fix.speedMps === 0 && fix.staying === true);
  const parts = trailDrawParts(current);
  assert.equal(paintParts(parts).includes(`${gap.lat.toFixed(5)},${gap.lng.toFixed(5)}`), true);
  assert.equal(parts.some((part) => part.dashed), false);
  assert.equal(parts.some((part) => part.points.some((point) => point.lat === gap.lat)), true);
  const continued = parts.filter((part) => part.points[part.points.length - 1].at > gap.at);
  assert.ok(continued.some((part) => !part.dashed && part.points.length >= 2));
  assert.equal(continued.some((part) => part.dashed), false);
  assert.ok(draw112(previous).some((part) => part.dashed));
});

test('records include archived journeys even when the live segment is gone', () => {
  const saved = recordsDayTrails({ journeys: [journey], livePoints: [{ lat: 37.51, lng: 127.01, at: 9 }], liveDrawable: false });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].length, 2);
  const both = recordsDayTrails({ journeys: [journey], livePoints: live, liveDrawable: true });
  assert.equal(both.length, 2);
  assert.equal(recordsDayTrails({ journeys: [], livePoints: live, liveDrawable: false }).length, 0);
});
