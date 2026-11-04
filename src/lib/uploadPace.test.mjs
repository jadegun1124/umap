import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { appendTrailPart, emptyRoom, placeWriteHeld } from '../../sync/protocol.mjs';
import { mergeTrailPoints } from './trailParts.mjs';
import { planUploads, uploadPaceFromJava } from './uploadPace.mjs';

const java = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/LocationKeepService.java', import.meta.url), 'utf8');

function seal() {
  return {
    v: 1,
    alg: 'A256GCM',
    kid: 'a'.repeat(16),
    iv: Buffer.alloc(12, 1).toString('base64url'),
    ct: Buffer.alloc(16, 2).toString('base64url'),
  };
}

test('moving uploads every 30s, still every 60s, and a state change uploads now', () => {
  const pace = uploadPaceFromJava(java);
  assert.equal(pace.movingMs, 30_000);
  assert.equal(pace.stillMs, 60_000);
  assert.equal(java.includes('PUBLISH_MOVING_M'), false);
  assert.match(java, /upload\.moving = movingNow/);
  assert.match(java, /heldBack = true/);
  assert.match(java, /return heldBack \? 0 : 1/);

  const moving = [];
  for (let at = 0; at <= 90_000; at += 2_000) moving.push({ at, moving: true });
  const movingUploads = planUploads(pace, moving).map((row) => row.at);
  assert.deepEqual(movingUploads, [0, 30_000, 60_000, 90_000]);

  const still = [];
  for (let at = 0; at <= 120_000; at += 20_000) still.push({ at, moving: false });
  assert.deepEqual(planUploads(pace, still).map((row) => row.at), [0, 60_000, 120_000]);

  const jumped = planUploads(pace, [
    { at: 0, moving: false },
    { at: 20_000, moving: false },
    { at: 25_000, moving: true },
    { at: 27_000, moving: true },
    { at: 55_000, moving: true },
    { at: 56_000, moving: false },
    { at: 80_000, moving: false },
    { at: 116_000, moving: false },
  ]);
  assert.deepEqual(jumped, [
    { at: 0, reason: 'interval' },
    { at: 25_000, reason: 'state' },
    { at: 55_000, reason: 'interval' },
    { at: 56_000, reason: 'state' },
    { at: 116_000, reason: 'interval' },
  ]);
});

test('a 1.54 place is still held for 8s, and a flush or trail batch is stored', () => {
  const plain = { sharing: true };
  assert.equal(placeWriteHeld(plain, 1_000, 4_000, true), true);
  assert.equal(placeWriteHeld(plain, 1_000, 10_000, true), false);
  assert.equal(placeWriteHeld({ sharing: true, flush: true }, 1_000, 2_000, true), false);
  assert.equal(placeWriteHeld({ sharing: true, trailSeal: seal() }, 1_000, 2_000, true), false);
  const first = appendTrailPart(emptyRoom(), 'local-owner01', 2_000, true, seal());
  assert.equal(first.ignored, false);
  assert.equal(first.room.trails['local-owner01'].parts.length, 1);
  assert.equal(first.room.trails['local-owner01'].seal, undefined);
  const second = appendTrailPart(first.room, 'local-owner01', 32_000, true, { ...seal(), ct: Buffer.alloc(16, 9).toString('base64url') });
  assert.equal(second.room.trails['local-owner01'].parts.length, 2);
  assert.equal(second.room.trails['local-owner01'].points, undefined);
  assert.deepEqual(mergeTrailPoints([{ at: 1, lat: 1 }], [{ at: 1, lat: 9 }, { at: 2, lat: 2 }]), [
    { at: 1, lat: 1 },
    { at: 2, lat: 2 },
  ]);
});
