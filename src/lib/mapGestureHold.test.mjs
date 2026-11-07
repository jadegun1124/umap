import assert from 'node:assert/strict';
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

test('a nested batch is not replayed as itself', () => {
  const queue = [{ type: 'batch', actions: [] }, { type: 'set-motion', moving: true }];
  assert.deepEqual(heldMapActions(queue).map((action) => action.type), ['set-motion']);
});
