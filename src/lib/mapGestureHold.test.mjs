import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { heldMapActions, isMapHoldAction, queueMapAction } from './mapGestureHold.mjs';

test('a finger-down poll is queued and everything else still dispatches', () => {
  const queue = [];
  assert.equal(queueMapAction(true, queue, { type: 'update-self', lat: 1 }), true);
  assert.equal(queueMapAction(true, queue, { type: 'set-room-family-places', code: 'a' }), true);
  assert.equal(queueMapAction(true, queue, { type: 'notice' }), false);
  assert.equal(queueMapAction(true, queue, { type: 'logout' }), false);
  assert.equal(queueMapAction(false, queue, { type: 'set-battery' }), false);
  assert.equal(queue.length, 2);
  assert.equal(isMapHoldAction('set-battery'), true);
  assert.equal(isMapHoldAction('save-home'), false);
  assert.deepEqual(heldMapActions(queue).map((action) => action.type), ['update-self', 'set-room-family-places']);
  assert.equal(queue.length, 0);
});

test('a queued fix keeps the arrival clock and unmount releases the hold', () => {
  const session = readFileSync(new URL('../components/family/session.tsx', import.meta.url), 'utf8');
  const screen = readFileSync(new URL('../components/family/FamilyMapScreen.tsx', import.meta.url), 'utf8');
  const map = readFileSync(new URL('../components/family/StreetMap.tsx', import.meta.url), 'utf8');
  assert.match(session, /at: Date\.now\(\)/);
  assert.match(session, /Number\.isFinite\(action\.at\) \? action\.at : Date\.now\(\)/);
  assert.match(screen, /familyRef\.current\.endMapGesture\(\)/);
  assert.match(map, /if \(movingRef\.current \|\| userGesture\)/);
});

test('a nested batch is not replayed as itself', () => {
  const queue = [{ type: 'batch', actions: [] }, { type: 'set-motion', moving: true }];
  assert.deepEqual(heldMapActions(queue).map((action) => action.type), ['set-motion']);
});
