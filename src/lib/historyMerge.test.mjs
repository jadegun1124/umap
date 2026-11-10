import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyMemberTrail,
  journeysToPublish,
  planAccountBackup,
  shouldApplyTrailResponse,
} from './historyMerge.mjs';

function trip(id, endedAt, distanceM = 400) {
  const startedAt = endedAt - 10 * 60_000;
  return {
    id,
    startedAt,
    endedAt,
    distanceM,
    points: [
      { lat: 37.5, lng: 127, at: startedAt },
      { lat: 37.51, lng: 127.01, at: endedAt },
    ],
    start: { lat: 37.5, lng: 127, label: null },
    end: { lat: 37.51, lng: 127.01, label: null },
  };
}

test('publish keeps the newest vehicle trip when older walks fill the old 16 cap', () => {
  const now = Date.now();
  const walks = [];
  for (let index = 0; index < 50; index += 1) walks.push(trip(`walk-${index}`, now - (60 - index) * 60_000));
  const drive = trip('khoon-drive', now - 60_000, 9200);
  const published = journeysToPublish([...walks, drive]);
  assert.equal(published.some((item) => item.id === 'khoon-drive'), true);
  assert.equal(published.some((item) => item.id === 'walk-0'), false);
});

test('a newer empty trail does not remove a vehicle journey already on the phone', () => {
  const now = Date.now();
  const drive = trip('khoon-drive', now - 5 * 60_000, 6400);
  const kept = applyMemberTrail({
    at: now - 10_000,
    points: drive.points,
    journeys: [drive],
    moving: false,
  }, {
    at: now,
    points: [],
    journeys: [],
    moving: false,
  });
  assert.equal(kept.journeys.some((item) => item.id === 'khoon-drive'), true);
  assert.equal(kept.points.length, 2);
});

test('an older poll does not replace a newer journey list', () => {
  const now = Date.now();
  const current = applyMemberTrail({
    at: now,
    points: [{ lat: 37.5, lng: 127, at: now }],
    journeys: [trip('newer', now, 800)],
    moving: false,
  }, {
    at: now - 60_000,
    points: [{ lat: 37.1, lng: 127.1, at: now - 60_000 }],
    journeys: [trip('older', now - 60_000, 100)],
    moving: true,
  });
  assert.equal(current.changed, false);
  assert.equal(current.journeys[0].id, 'newer');
});

test('a failed or 403 trail response is not applied as an empty record list', () => {
  assert.equal(shouldApplyTrailResponse(403, []), false);
  assert.equal(shouldApplyTrailResponse(0, null), false);
  assert.equal(shouldApplyTrailResponse(200, []), true);
});

test('a backup waits when the server cannot be read and otherwise unions by id', () => {
  const local = [trip('local-walk', Date.now() - 3 * 60 * 60_000)];
  const held = planAccountBackup({
    localJourneys: [],
    localVisits: [],
    remoteOk: false,
    remoteJourneys: [trip('server-drive', Date.now(), 5000)],
    remoteVisits: [],
  });
  assert.equal(held.keepHistory, true);
  assert.equal(held.journeys.length, 0);
  const unread = planAccountBackup({
    localJourneys: local,
    localVisits: [],
    remoteOk: false,
    remoteLocked: false,
    remoteJourneys: [],
    remoteVisits: [],
  });
  assert.equal(unread.keepHistory, true);
  assert.equal(unread.journeys.length, 0);
  const remote = [trip('khoon-drive', Date.now(), 7000)];
  const merged = planAccountBackup({
    localJourneys: local,
    localVisits: [],
    remoteOk: true,
    remoteLocked: false,
    remoteJourneys: remote,
    remoteVisits: [],
  });
  assert.equal(merged.keepHistory, false);
  assert.equal(merged.journeys.some((item) => item.id === 'khoon-drive'), true);
  assert.equal(merged.journeys.some((item) => item.id === 'local-walk'), true);
  const locked = planAccountBackup({
    localJourneys: local,
    localVisits: [],
    remoteOk: true,
    remoteLocked: true,
    remoteJourneys: [],
    remoteVisits: [],
  });
  assert.equal(locked.keepHistory, false);
  assert.equal(locked.journeys.some((item) => item.id === 'local-walk'), true);
});
