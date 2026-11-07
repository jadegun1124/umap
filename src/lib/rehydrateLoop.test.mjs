import assert from 'node:assert/strict';
import test from 'node:test';
import { visitsWithinHistory } from './tracking.mjs';
import { liveHistoryScore, mergedSessionRaw, parseStoredSession, shouldRehydrateMerged } from './sessionDurable.mjs';

const HOUR = 3600_000;

function sessionWith(visits) {
  return { inviteCode: 'X', members: [{ id: 'm' }], permissions: {}, profile: { name: 'a' }, tracks: {}, journeys: {}, visits: { m: visits } };
}

/** A load() that trims harder than the merge: the shape that froze 1.75 once a member passed 40 visits. */
function strictLoad(raw, now) {
  const parsed = parseStoredSession(raw);
  const visits = {};
  for (const [id, list] of Object.entries(parsed.visits)) visits[id] = list.slice(-40);
  return { ...parsed, visits: visitsWithinHistory(visits, now) };
}

test('a richer merged copy is rehydrated once, not forever', () => {
  const now = Date.now();
  const visits = Array.from({ length: 45 }, (_, i) => ({
    id: `v${i}`, lat: 37.5, lng: 127, arrivedAt: now - (45 - i) * 2.5 * HOUR, leftAt: null, label: null, source: 'coords',
  }));
  let durableHold = JSON.stringify(sessionWith(visits));
  let state = strictLoad(durableHold, now);
  let guard = -1;
  let rehydrates = 0;
  for (let i = 0; i < 20; i += 1) {
    const merged = mergedSessionRaw(durableHold, JSON.stringify(state));
    const mergedScore = liveHistoryScore(parseStoredSession(merged), now);
    if (!shouldRehydrateMerged(mergedScore, liveHistoryScore(state, now), guard)) break;
    guard = mergedScore;
    durableHold = merged;
    state = strictLoad(merged, now);
    rehydrates += 1;
  }
  assert.equal(rehydrates, 1);
  // The stored copy still holds every visit; only the screen is trimmed.
  assert.equal(parseStoredSession(durableHold).visits.m.length, 45);
});

test('shouldRehydrateMerged', () => {
  assert.equal(shouldRehydrateMerged(10, 5, -1), true);
  assert.equal(shouldRehydrateMerged(10, 5, 10), false);
  assert.equal(shouldRehydrateMerged(12, 5, 10), true);
  assert.equal(shouldRehydrateMerged(5, 5, -1), false);
  assert.equal(shouldRehydrateMerged(4, 5, -1), false);
});
