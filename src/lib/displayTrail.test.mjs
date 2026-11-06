import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DISPLAY_TRAIL_CAP, PREVIEW_TRAIL_CAP, displaySolidTrail, trailGeometryKey } from './displayTrail.mjs';
import { trailDrawParts } from './tracking.mjs';

function text(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function walk(count, gapAt = -1) {
  const points = [];
  for (let index = 0; index < count; index += 1) {
    const jump = gapAt >= 0 && index >= gapAt ? 0.2 : 0;
    points.push({
      lat: 37.55 + index * 0.00001,
      lng: 127.01 + index * 0.00002 + jump,
      at: 1_700_000_000_000 + index * 2_000,
      speedMps: 1.3,
      accuracyM: 12,
      staying: false,
    });
  }
  return points;
}

test('display sampling keeps one solid line and does not change stored points', () => {
  const points = walk(3000, 1500);
  const before = points.map((point) => point.lng);
  Object.freeze(points);
  const line = displaySolidTrail(points, PREVIEW_TRAIL_CAP);
  assert.notEqual(line, points);
  assert.equal(points.length, 3000);
  assert.deepEqual(points.map((point) => point.lng), before);
  assert.equal(line[0], points[0]);
  assert.equal(line[line.length - 1], points[points.length - 1]);
  assert.ok(line.length >= 2 && line.length <= PREVIEW_TRAIL_CAP);
  for (let index = 1; index < line.length; index += 1) {
    assert.ok(line[index].at >= line[index - 1].at);
  }
  const gap = line.some((point, index) => index > 0 && point.lng - line[index - 1].lng > 0.05);
  assert.equal(gap, true);
  assert.equal(displaySolidTrail(points, DISPLAY_TRAIL_CAP).length <= DISPLAY_TRAIL_CAP, true);
  assert.deepEqual(displaySolidTrail(points.slice(0, 10)), points.slice(0, 10));
});

test('40 journeys of 3000 points downsample for display without dropping the source', () => {
  const journeys = Array.from({ length: 40 }, (_, journey) => walk(3000).map((point, index) => ({
    ...point,
    lat: point.lat + journey * 0.01,
    at: point.at + index,
  })));
  const started = performance.now();
  const drawn = journeys.map((points) => displaySolidTrail(points, PREVIEW_TRAIL_CAP));
  const displayMs = performance.now() - started;
  const paintStarted = performance.now();
  const parts = trailDrawParts(journeys[0]);
  const paintMs = performance.now() - paintStarted;
  console.log(`displayTrail 40x3000 ${displayMs.toFixed(1)}ms; trailDrawParts one journey ${paintMs.toFixed(1)}ms; vertices ${drawn[0].length}`);
  assert.ok(displayMs < 500, `display downsample took ${displayMs.toFixed(1)}ms`);
  assert.equal(drawn.length, 40);
  for (const [index, line] of drawn.entries()) {
    assert.equal(journeys[index].length, 3000);
    assert.equal(line[0].lat, journeys[index][0].lat);
    assert.equal(line[line.length - 1].lat, journeys[index][journeys[index].length - 1].lat);
    assert.ok(line.length <= PREVIEW_TRAIL_CAP);
  }
  assert.ok(parts.length >= 1);
});

test('an unchanged trail key skips a redraw and a new point does not', () => {
  const line = walk(8);
  const first = trailGeometryKey([line]);
  assert.equal(first, trailGeometryKey([[...line]]));
  const longer = line.concat([{ lat: line[7].lat, lng: line[7].lng + 0.001, at: line[7].at + 2000 }]);
  assert.notEqual(first, trailGeometryKey([longer]));
  assert.notEqual(first, trailGeometryKey([]));
});

test('renderer death is handled and records errors stay inside the list', () => {
  const main = text('../../android/app/src/main/java/kr/co/umap/tracker/MainActivity.java');
  assert.match(main, /onRenderProcessGone/);
  assert.match(main, /return true/);
  assert.match(main, /recreate\(\)/);
  assert.match(main, /lastRendererRecoverAt/);
  assert.match(main, /postDelayed/);
  assert.match(main, /rendererRecoverQueued/);
  const street = text('../components/family/StreetMap.tsx');
  assert.match(street, /_zooming/);
  assert.match(street, /armSafety\(\)/);
  assert.match(street, /held\.circle\.setLatLng/);
  const screen = text('../components/family/FamilyMapScreen.tsx');
  assert.match(screen, /RecordsBoundary/);
  assert.match(screen, /screenMapTrails/);
  assert.match(screen, /solidTrails=\{detailOpen\}/);
  const cards = text('../components/family/JourneyCards.tsx');
  assert.match(cards, /RECORD_PREVIEW_MAP_CAP/);
  assert.match(cards, /displaySolidTrail/);
  assert.match(cards, /map\.remove\(\)/);
});
