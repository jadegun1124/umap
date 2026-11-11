import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { appendTrailPart, emptyRoom, placeWriteHeld } from '../../sync/protocol.mjs';
import { mergeTrailPoints } from './trailParts.mjs';
import { drainUploads, placePutsPerDay, planUploads, uploadPaceFromJava } from './uploadPace.mjs';

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

test('moving uploads every 10s, still every 60s, and a state change uploads now', () => {
  const pace = uploadPaceFromJava(java);
  assert.equal(pace.movingMs, 10_000);
  assert.equal(pace.stillMs, 60_000);
  assert.equal(java.includes('PUBLISH_MOVING_M'), false);
  assert.match(java, /upload\.moving = movingNow/);
  assert.match(java, /heldBack = true/);
  assert.match(java, /return heldBack \? 0 : 1/);

  const moving = [];
  for (let at = 0; at <= 90_000; at += 2_000) moving.push({ at, moving: true });
  const movingUploads = planUploads(pace, moving).map((row) => row.at);
  assert.deepEqual(movingUploads, [0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000]);

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

test('a 10s cadence sends each journal point once, and a backoff does not stack requests', () => {
  const pace = uploadPaceFromJava(java);
  const events = [];
  for (let index = 0; index < 200; index += 1) {
    const at = index * 2_000;
    events.push({
      at,
      moving: index < 150,
      point: { at, lat: 37.5, lng: 127 },
    });
  }
  const drained = drainUploads(pace, events);
  const flat = drained.sends.flatMap((send) => send.points.map((point) => point.at));
  assert.equal(new Set(flat).size, flat.length);
  assert.ok(drained.sends.every((send) => send.points.length <= 80));
  assert.equal(flat.includes(0), true);
  assert.equal(drained.sends.some((send) => send.at === 300_000 && send.reason === 'state'), true);
  const sent = new Set(flat);
  for (const event of events) {
    if (event.at <= 360_000) assert.equal(sent.has(event.at), true, `missing ${event.at}`);
  }
  assert.ok(drained.pending.every((point) => point.at > 360_000));

  const backed = drainUploads(pace, events, { backoffUntil: 30_000 });
  const during = backed.sends.filter((send) => send.at < 30_000);
  assert.deepEqual(during, []);
  assert.ok(backed.blocked >= 2);
  assert.equal(backed.sends[0].at, 30_000);
  assert.equal(backed.sends[0].points.length, 16);
  const again = backed.sends.flatMap((send) => send.points.map((point) => point.at));
  assert.equal(new Set(again).size, again.length);

  const before = { movingMs: 30_000, stillMs: 60_000 };
  assert.equal(placePutsPerDay(before, 8, 16), 1_920);
  assert.equal(placePutsPerDay(pace, 8, 16), 3_840);
  assert.equal(placePutsPerDay(before, 24, 0), 2_880);
  assert.equal(placePutsPerDay(pace, 24, 0), 8_640);
  assert.ok(placePutsPerDay(pace, 8, 16) * 4 < 100_000);
  assert.match(java, /UPLOAD_MOVING_MS = 10_000L/);
  assert.match(java, /UPLOAD_STILL_MS = 60_000L/);
  assert.match(java, /KEEP_HEARTBEAT_FRESH_MS = 90_000L/);
  assert.match(java, /WATCHDOG_ALARM_MS = 2 \* 60 \* 1000L/);
  assert.match(java, /UPLOAD_BATCH = 80/);
  assert.match(java, /UPLOAD_BACKOFF\.remaining/);
  assert.ok(pace.movingMs < 90_000);
  assert.ok(pace.stillMs < 90_000);
  assert.ok(120_000 > pace.stillMs);
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
