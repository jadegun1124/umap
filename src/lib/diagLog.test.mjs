import assert from 'node:assert/strict';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { clearDiag, fixChannelSource, noteDiag, packDiagUpload, readDiagCodes, readDiagEvents, reloadDiagRing, rememberDiagCode, trimDiagEvents } from './diagLog.mjs';

function memoryStorage() {
  const box = new Map();
  globalThis.localStorage = {
    getItem: (key) => box.get(key) ?? null,
    setItem: (key, value) => box.set(key, value),
    removeItem: (key) => box.delete(key),
  };
  return box;
}

test('the diagnostic ring keeps 24 hours in localStorage and drops the 25th hour', () => {
  const box = memoryStorage();
  noteDiag({ kind: 'fix', channel: 'native', source: 'gps', lat: 37.1234567, lng: 127.2, ok: true, accuracy: 12.44 });
  const fresh = readDiagEvents();
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].kind, 'fix');
  assert.equal(fresh[0].lat, 37.12346);
  assert.equal(fresh[0].accuracy, 12.4);
  const stored = JSON.parse(box.get('umap_diag_ring_v1'));
  stored[0].t = Date.now() - 23 * 60 * 60 * 1000;
  box.set('umap_diag_ring_v1', JSON.stringify(stored));
  reloadDiagRing();
  assert.equal(readDiagEvents().length, 1);
  stored[0].t = Date.now() - 25 * 60 * 60 * 1000;
  box.set('umap_diag_ring_v1', JSON.stringify(stored));
  reloadDiagRing();
  assert.equal(readDiagEvents().length, 0);
  noteDiag({ kind: 'fix', lat: 37.2, lng: 127.3 });
  assert.equal(readDiagEvents().length, 1);
  const again = JSON.parse(box.get('umap_diag_ring_v1'));
  assert.equal(again.length, 1);
  noteDiag({ kind: 'fix', lat: 37.4, lng: 127.4 });
  reloadDiagRing();
  assert.equal(readDiagEvents().length, 2);
  rememberDiagCode('abcdefghijklmnop', 10);
  clearDiag();
  assert.equal(readDiagEvents().length, 0);
  assert.deepEqual(readDiagCodes(), []);
  delete globalThis.localStorage;
});

test('a full ring drops render notes before location fixes', () => {
  const now = 1_700_000_000_000;
  const events = [];
  for (let index = 0; index < 6; index += 1) {
    events.push({ t: now - 1000 + index, kind: index % 2 === 0 ? 'render' : 'fix', lat: index });
  }
  const kept = trimDiagEvents(events, now, { maxEvents: 3, maxBytes: 10_000, windowMs: 60_000 });
  assert.equal(kept.every((event) => event.kind === 'fix'), true);
  assert.equal(kept.length, 3);
});

test('a large diagnostic upload is gzipped under the worker cap', async () => {
  const events = [];
  for (let index = 0; index < 4000; index += 1) {
    events.push({ t: index, kind: 'fix', channel: 'native', source: 'gps', lat: 37.1, lng: 127.1, ok: true, reason: 'accepted' });
  }
  const packed = await packDiagUpload(events, { rawMax: 20_000, gzipMax: 700_000 });
  const body = JSON.parse(packed);
  assert.equal(body.encoding, 'gzip');
  const raw = Uint8Array.from(atob(body.payload), (char) => char.charCodeAt(0));
  const opened = JSON.parse(gunzipSync(raw).toString('utf8'));
  assert.equal(opened.events.length > 100, true);
  assert.equal(packed.length < 700_000, true);
});

test('sent diagnostic codes stay on this phone', () => {
  memoryStorage();
  assert.deepEqual(readDiagCodes(), []);
  rememberDiagCode('abcdefghijklmnop', 10);
  rememberDiagCode('bbcdefghijklmnop', 20);
  rememberDiagCode('abcdefghijklmnop', 30);
  const codes = readDiagCodes();
  assert.deepEqual(codes.map((row) => row.id), ['abcdefghijklmnop', 'bbcdefghijklmnop']);
  assert.equal(codes[0].at, 30);
  delete globalThis.localStorage;
});

test('a native provider name is kept and a js coarse fix is network', () => {
  assert.equal(fixChannelSource('native', 'fused', true), 'fused');
  assert.equal(fixChannelSource('native', 'gps', true), 'gps');
  assert.equal(fixChannelSource('native', 'network', false), 'network');
  assert.equal(fixChannelSource('js', '', false), 'network');
  assert.equal(fixChannelSource('js', '', true), 'gps');
  assert.equal(fixChannelSource('native', '', true), 'unknown');
});
