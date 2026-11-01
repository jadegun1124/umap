import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { memberLiveLines, recordsDayTrails } from './mapTrail.mjs';
import { displayLivePoints, mergeJourneyLists, settleTrailPoint, storedTrackAfterArchive, trailDrawParts } from './tracking.mjs';

const rows = JSON.parse(readFileSync(new URL('./walkDiags.fixture.json', import.meta.url), 'utf8'));
const origin = { lat: 37.55, lng: 127.05 };
const t0 = Date.parse('2026-11-01T09:19:16Z');

function atPoint(row) {
  return {
    lat: origin.lat + row.n / 110540,
    lng: origin.lng + row.e / (111320 * Math.cos((origin.lat * Math.PI) / 180)),
    at: t0 + row.dt,
    speedMps: row.s,
    accuracyM: row.a,
    staying: row.s < 0.8,
  };
}

function meters(a, b) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function paint(lines) {
  const parts = [];
  for (const line of lines) parts.push(...trailDrawParts(line));
  return parts;
}

test('the two diag walks keep nearly every good walking fix and draw one solid line', () => {
  const walking = rows.filter((row) => row.a <= 25 && row.s >= 0.7 && row.s <= 2.6).map(atPoint);
  let points = [];
  let journeys = [];
  for (const row of rows) {
    const sample = atPoint(row);
    points = settleTrailPoint(points, sample, sample.at).points;
    const archived = storedTrackAfterArchive(points, sample.at);
    if (archived.journeys.length > 0) {
      journeys = mergeJourneyLists(journeys, archived.journeys);
      points = archived.points;
    }
  }
  const kept = [...points, ...journeys.flatMap((journey) => journey.points || [])].filter((point) => point && !point.stayEnd);
  const matched = walking.filter((sample) => kept.some((point) => Math.abs(point.at - sample.at) <= 2_000 && meters(point, sample) <= 4));
  assert.ok(matched.length / walking.length >= 0.9, `kept ${matched.length} of ${walking.length}`);

  const last = atPoint(rows[rows.length - 1]);
  const member = {
    id: 'self',
    role: 'self',
    share: 'allowed',
    lat: last.lat,
    lng: last.lng,
    updatedAt: last.at,
    accuracyM: last.accuracyM,
  };
  const mapLine = memberLiveLines(member, { self: points }, last.at);
  assert.equal(mapLine.reason, 'draw', `main map ${mapLine.reason} stored ${mapLine.stored} live ${mapLine.live}`);
  const records = recordsDayTrails({
    journeys,
    livePoints: displayLivePoints(points, last.at),
    liveDrawable: mapLine.lines.length > 0,
  });
  assert.ok(records.some((line) => line.length >= 2), 'records screen has no trail');
  const lines = [...mapLine.lines, ...records];
  const parts = paint(lines);
  assert.equal(parts.some((part) => part.dashed), false);
  assert.ok(parts.some((part) => !part.dashed && part.points.length >= 2));
  const covered = Math.max(...lines.flatMap((line) => line.map((point) => meters(origin, point))));
  assert.ok(covered > 200, `drawn trail only reaches ${Math.round(covered)}m`);
});
