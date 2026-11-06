import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { BACKGROUND_POLL_MIN_MS, CHAT_LIST_POLL_MS, CHAT_OPEN_POLL_MS, FAMILY_KEY_SYNC_MS, FAMILY_POLL_MS, HEALTH_POLL_MS, KEY_PUT_WINDOW_MS, ROOM_POLL_MS, blockRoom, quotaPollPaused, resetBlockedRooms, resumeRoom, roomBlocked, roomPollAction, shouldRefreshFamilyKeys } from './keySyncPace.mjs';

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
  assert.equal(FAMILY_POLL_MS, 30_000);
  assert.equal(CHAT_LIST_POLL_MS, 60_000);
  assert.equal(CHAT_OPEN_POLL_MS, 5_000);
  assert.equal(HEALTH_POLL_MS, 120_000);
  assert.ok(BACKGROUND_POLL_MIN_MS >= 12_000);
  assert.ok(KEY_PUT_WINDOW_MS >= 30_000 && KEY_PUT_WINDOW_MS <= 60_000);
});

test('a member 403 can register once, then a profile-key 403 retries instead of stopping', () => {
  assert.equal(roomPollAction(200, '', { canRegister: true, attempted: false }), 'continue');
  assert.equal(roomPollAction(403, 'member', { canRegister: true, attempted: false }), 'register');
  assert.equal(roomPollAction(403, 'member', { canRegister: true, attempted: true }), 'recover');
  assert.equal(roomPollAction(403, 'member', { canRegister: false, attempted: false }), 'recover');
  assert.equal(roomPollAction(403, 'profile-key', { canRegister: true, attempted: true }), 'recover');
  assert.equal(roomPollAction(403, 'read-key', { canRegister: true, attempted: false }), 'block');
  assert.equal(roomPollAction(403, 'revoked', { canRegister: true, attempted: false }), 'block');
  const source = readFileSync(new URL('../services/familySync.ts', import.meta.url), 'utf8');
  assert.match(source, /\/v1\/rooms\/\$\{link\.code\}\/family/);
  assert.equal(source.includes('request(`/v1/rooms/${link.code}`'), false);
  assert.match(source, /x-umap-read-key': link\.readKey/);
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
