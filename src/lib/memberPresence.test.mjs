import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEMBER_DISCONNECTED_MS,
  MEMBER_STALE_MS,
  cleanDepartedIds,
  hideLeftPublishers,
  memberIsStale,
  memberPresence,
  memberPresenceLabel,
  pinAgeLabel,
  relativePlaceAge,
  sharedPlaceStopsReporting,
} from './memberPresence.mjs';

test('a live member keeps the usual status and a stopped phone keeps last location', () => {
  const now = Date.UTC(2026, 9, 29, 0, 0);
  const live = { id: 'm-1', role: 'child', updatedAt: now - 2 * 60_000 };
  const fading = { id: 'm-1', role: 'child', updatedAt: now - 4 * 60_000 };
  const stale = { id: 'm-1', role: 'child', updatedAt: now - 3 * 60 * 60_000 };
  assert.equal(memberPresence(live, now).kind, 'live');
  assert.equal(memberPresence(live, now).ago, '2분 전');
  assert.equal(pinAgeLabel(memberPresence(live, now)), '2분 전');
  assert.equal(memberPresenceLabel(memberPresence(live, now)), '');
  assert.equal(memberIsStale(memberPresence(live, now)), false);
  assert.equal(memberPresence(fading, now).kind, 'live');
  assert.equal(memberPresence(fading, now).ago, '4분 전');
  assert.equal(memberIsStale(memberPresence(fading, now)), true);
  assert.equal(memberPresence(stale, now).kind, 'stale');
  assert.equal(memberPresenceLabel(memberPresence(stale, now)), '마지막 위치 · 3시간 전');
  assert.equal(pinAgeLabel(memberPresence(stale, now)), '마지막 위치 · 3시간 전');
  assert.equal(memberIsStale(memberPresence(stale, now)), true);
  assert.equal(relativePlaceAge(now - MEMBER_STALE_MS, now), '10분 전');
});

test('after seven days the card is 연결 끊김', () => {
  const now = Date.UTC(2026, 9, 29, 0, 0);
  const gone = { id: 'm-1', role: 'child', updatedAt: now - MEMBER_DISCONNECTED_MS };
  assert.equal(memberPresence(gone, now).kind, 'disconnected');
  assert.equal(memberPresenceLabel(memberPresence(gone, now)), '연결 끊김');
  assert.equal(memberPresence({ id: 'self', role: 'self', updatedAt: now - 3 * 60 * 60_000 }, now).kind, 'stale');
  assert.equal(memberPresenceLabel(memberPresence({ id: 'self', role: 'self', updatedAt: now - 3 * 60 * 60_000 }, now)), '마지막 위치 · 3시간 전');
  assert.equal(memberPresence({ id: 'self', role: 'self', updatedAt: now - MEMBER_DISCONNECTED_MS }, now).kind, 'disconnected');
});

test('departed ids are member ids only', () => {
  assert.deepEqual(cleanDepartedIds(['local-aaa', 'local-aaa', '엄마', '', 'local-bbb']), ['local-aaa', 'local-bbb']);
});

function applySharedPlaceLikeSession(state, place) {
  if (sharedPlaceStopsReporting(place)) return state;
  if (place.audience === 'family') return state;
  const publisher = typeof place.memberId === 'string' ? place.memberId : '';
  return hideLeftPublishers(state, publisher ? [publisher] : []);
}

test('sharing false never drops the roster or local history', () => {
  const leftover = {
    id: 'family:48291:local-aaa',
    role: 'child',
    publisherId: 'local-aaa',
    lat: 37.64,
    lng: 127.08,
  };
  const tracks = { [leftover.id]: [{ lat: 37.64, lng: 127.08, at: 1 }] };
  const journeys = { [leftover.id]: [{ id: 'j1', startedAt: 1, endedAt: 2 }] };
  const visits = { [leftover.id]: [{ at: 1 }] };
  const trailRevisions = { 'local-aaa': 4 };
  const state = {
    members: [{ id: 'self', role: 'self' }, leftover],
    tracks,
    journeys,
    visits,
    trailRevisions,
    hiddenMemberIds: [],
  };
  const adminStop = { sharing: false, memberId: 'local-aaa', audience: 'admin' };
  assert.equal(sharedPlaceStopsReporting(adminStop), true);
  const afterAdmin = applySharedPlaceLikeSession(state, adminStop);
  assert.equal(afterAdmin, state);
  assert.equal(afterAdmin.members.length, 2);
  assert.equal(afterAdmin.tracks[leftover.id], tracks[leftover.id]);
  assert.equal(afterAdmin.journeys[leftover.id], journeys[leftover.id]);
  assert.equal(afterAdmin.visits[leftover.id], visits[leftover.id]);
  assert.deepEqual(afterAdmin.trailRevisions, trailRevisions);
  const afterFamilyStop = applySharedPlaceLikeSession(state, { ...adminStop, audience: 'family' });
  assert.equal(afterFamilyStop, state);
});

test('an explicit departed id hides the card and keeps history', () => {
  const leftover = {
    id: 'family:48291:local-aaa',
    role: 'child',
    publisherId: 'local-aaa',
  };
  const tracks = { [leftover.id]: [{ lat: 37.64, lng: 127.08, at: 1 }] };
  const journeys = { [leftover.id]: [{ id: 'j1' }] };
  const visits = { [leftover.id]: [{ at: 1 }] };
  const trailRevisions = { 'local-aaa': 4 };
  const hidden = hideLeftPublishers({
    members: [{ id: 'self', role: 'self' }, leftover],
    tracks,
    journeys,
    visits,
    trailRevisions,
    hiddenMemberIds: [],
  }, ['local-aaa']);
  assert.equal(hidden.members.some((member) => member.publisherId === 'local-aaa'), false);
  assert.equal(hidden.members[0].id, 'self');
  assert.deepEqual(hidden.tracks, tracks);
  assert.deepEqual(hidden.journeys, journeys);
  assert.deepEqual(hidden.visits, visits);
  assert.deepEqual(hidden.trailRevisions, trailRevisions);
  assert.deepEqual(hidden.hiddenMemberIds, []);
});
