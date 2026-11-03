import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldHoldPlaceWrite } from './protocol.mjs';
import { presentRoomResponse } from './worker.mjs';
import { QUOTA_RETRY_MS, syncPhaseAfterResponse } from '../src/lib/keySyncPace.mjs';

test('a stop or a sharing change inside 8s is stored immediately', () => {
  const live = { previousSharing: true, sharing: true, lastPersistedAt: 10_000, at: 12_000 };
  assert.equal(shouldHoldPlaceWrite(live), true);
  assert.equal(shouldHoldPlaceWrite({ ...live, sharing: false }), false);
  assert.equal(shouldHoldPlaceWrite({ ...live, previousSharing: false, sharing: true }), false);
  assert.equal(shouldHoldPlaceWrite({ ...live, at: 18_000 }), false);
});

test('an alert quota 503 stays 503 so the SOS stays queued', async () => {
  const limited = Response.json({ error: 'quota', message: '한도' }, { status: 503 });
  const passed = await presentRoomResponse('alert', limited);
  assert.equal(passed.status, 503);
  assert.equal((await passed.json()).error, 'quota');
  const stored = Response.json({ ok: true, pushes: [], payload: null });
  const rewritten = await presentRoomResponse('alert', stored);
  assert.equal(rewritten.status, 200);
  assert.equal((await rewritten.json()).ok, true);
  const chat = await presentRoomResponse('chat', Response.json({ error: 'quota' }, { status: 503 }));
  assert.equal(chat.status, 503);
  assert.equal((await chat.json()).error, 'quota');
});

test('a successful read does not clear the quota banner before the backoff', () => {
  const now = 5_000_000;
  const held = syncPhaseAfterResponse('limited', {
    ok: true,
    status: 200,
    method: 'GET',
    now,
    limitedUntil: now + QUOTA_RETRY_MS,
  });
  assert.equal(held.phase, 'limited');
  const wrote = syncPhaseAfterResponse('limited', {
    ok: true,
    status: 200,
    method: 'PUT',
    now,
    limitedUntil: now + QUOTA_RETRY_MS,
  });
  assert.equal(wrote.phase, 'live');
  const later = syncPhaseAfterResponse('limited', {
    ok: true,
    status: 200,
    method: 'GET',
    now: now + QUOTA_RETRY_MS,
    limitedUntil: now + QUOTA_RETRY_MS,
  });
  assert.equal(later.phase, 'live');
});
