import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  FOLLOW_GAP_MS,
  FOLLOW_MOVE_M,
  createMapFollow,
  followTargetId,
  noteFollowTarget,
  noteRecenter,
  noteUserDrag,
  planFollowPan,
  recenterLabel,
} from './mapFollow.mjs';

function text(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function step(state, extra) {
  return planFollowPan(state, {
    now: 1_000_000,
    foreground: true,
    mapVisible: true,
    dragging: false,
    memberId: 'self',
    lat: 37.5,
    lng: 127.0,
    ...extra,
  });
}

test('the map follows self when self is selected and the fix moves', () => {
  assert.equal(followTargetId('self'), 'self');
  assert.equal(followTargetId(null), 'self');
  let state = noteFollowTarget(createMapFollow(), 'self');
  const first = step(state, { now: 1_000 });
  assert.deepEqual(first.pan, { lat: 37.5, lng: 127.0 });
  state = first.state;
  const tiny = step(state, { now: 1_200, lat: 37.50001, lng: 127.0 });
  assert.equal(tiny.pan, null);
  const moved = step(state, { now: 1_200, lat: 37.5004, lng: 127.0 });
  assert.ok(moved.pan);
  assert.equal(moved.pan.lat, 37.5004);
  const later = step(state, { now: 1_000 + FOLLOW_GAP_MS, lat: 37.50002, lng: 127.0 });
  assert.ok(later.pan);
  assert.ok(FOLLOW_MOVE_M >= 10);
});

test('a drag stops follow and 내 위치로 starts it again', () => {
  let state = step(noteFollowTarget(createMapFollow(), 'self'), { now: 1_000 }).state;
  state = noteUserDrag(state);
  assert.equal(state.following, false);
  assert.equal(step(state, { now: 5_000, lat: 37.51, lng: 127.01 }).pan, null);
  state = noteRecenter(state);
  assert.equal(state.following, true);
  const again = step(state, { now: 6_000, lat: 37.51, lng: 127.01 });
  assert.deepEqual(again.pan, { lat: 37.51, lng: 127.01 });
  assert.equal(recenterLabel('self', '엄마'), '내 위치로');
});

test('a selected family member is followed and self updates are ignored', () => {
  assert.equal(followTargetId('family:48291:local-dadaaa'), 'family:48291:local-dadaaa');
  let state = noteFollowTarget(createMapFollow('self'), 'family:48291:local-dadaaa');
  assert.equal(state.following, true);
  const selfMove = step(state, { now: 2_000, memberId: 'self', lat: 37.6, lng: 127.1 });
  assert.equal(selfMove.pan, null);
  const dad = step(state, { now: 2_000, memberId: 'family:48291:local-dadaaa', lat: 37.55, lng: 127.02 });
  assert.deepEqual(dad.pan, { lat: 37.55, lng: 127.02 });
  assert.equal(recenterLabel(state.targetId, '아빠'), '아빠 위치로');
});

test('follow stays quiet in the background, off the map, and while a finger is down', () => {
  const state = step(createMapFollow(), { now: 1_000 }).state;
  assert.equal(step(state, { now: 4_000, lat: 37.51, foreground: false }).pan, null);
  assert.equal(step(state, { now: 4_000, lat: 37.51, mapVisible: false }).pan, null);
  assert.equal(step(state, { now: 4_000, lat: 37.51, dragging: true }).pan, null);
  const screen = text('../components/family/FamilyMapScreen.tsx');
  const map = text('../components/family/StreetMap.tsx');
  assert.match(screen, /recenterLabel/);
  assert.match(screen, /planFollowPan/);
  assert.match(screen, /noteUserDrag/);
  assert.match(screen, /noteRecenter/);
  assert.match(screen, /recenterFollow/);
  assert.match(screen, /visibleMembers\.find\(\(member\) => member\.id === followId\)/);
  assert.match(screen, /if \(placingHome\)/);
  assert.match(screen, /awaitingFamilyFit/);
  assert.match(map, /dragstart/);
  assert.match(map, /map\.stop\(\)/);
  assert.match(map, /followTo/);
});
