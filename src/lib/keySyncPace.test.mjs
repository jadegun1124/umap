import assert from 'node:assert/strict';
import test from 'node:test';
import { BACKGROUND_POLL_MIN_MS, CHAT_LIST_POLL_MS, CHAT_OPEN_POLL_MS, FAMILY_KEY_SYNC_MS, HEALTH_POLL_MS, KEY_PUT_WINDOW_MS, ROOM_POLL_MS, blockRoom, quotaPollPaused, resetBlockedRooms, resumeRoom, roomBlocked, shouldRefreshFamilyKeys } from './keySyncPace.mjs';

test('a phone that already has the family key does not upload keys every poll', () => {
  const now = 1_000_000;
  assert.equal(shouldRefreshFamilyKeys(now - 1_000, now, true), false);
  assert.equal(shouldRefreshFamilyKeys(now - FAMILY_KEY_SYNC_MS, now, true), true);
  assert.equal(shouldRefreshFamilyKeys(now, now, false), false);
  assert.equal(shouldRefreshFamilyKeys(undefined, now, false), true);
  assert.equal(shouldRefreshFamilyKeys(undefined, now, true), true);
  assert.equal(quotaPollPaused('limited', now, now + 1000), true);
  assert.equal(quotaPollPaused('limited', now + 1000, now + 1000), false);
  assert.equal(quotaPollPaused('live', now, now + 1000), false);
  assert.equal(ROOM_POLL_MS, 10_000);
  assert.equal(CHAT_LIST_POLL_MS, 60_000);
  assert.equal(CHAT_OPEN_POLL_MS, 5_000);
  assert.equal(HEALTH_POLL_MS, 120_000);
  assert.ok(BACKGROUND_POLL_MIN_MS >= 12_000);
  assert.ok(KEY_PUT_WINDOW_MS >= 30_000 && KEY_PUT_WINDOW_MS <= 60_000);
});

test('a 403 stops polling that room until login or rejoin', () => {
  resetBlockedRooms();
  const events = [];
  const previous = globalThis.window;
  globalThis.window = { dispatchEvent: (event) => { events.push(event.detail); } };
  try {
    assert.equal(roomBlocked('48291'), false);
    blockRoom('48291');
    assert.equal(roomBlocked('48291'), true);
    assert.equal(roomBlocked('10001'), false);
    resumeRoom('48291');
    assert.equal(roomBlocked('48291'), false);
    assert.deepEqual(events, ['48291']);
    blockRoom('48291');
    resumeRoom();
    assert.equal(roomBlocked('48291'), false);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
    resetBlockedRooms();
  }
});
