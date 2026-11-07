import assert from 'node:assert/strict';
import test from 'node:test';
import { clearDiag, fixChannelSource, flushDiag, noteDiag, readDiagEvents } from './diagLog.mjs';

test('the diagnostic ring keeps two hours and the newest 5000 notes', () => {
  const box = new Map();
  globalThis.localStorage = {
    getItem: (key) => box.get(key) ?? null,
    setItem: (key, value) => box.set(key, value),
  };
  noteDiag({ kind: 'fix', channel: 'native', source: 'gps', lat: 37.1, lng: 127.2, ok: true });
  const fresh = readDiagEvents();
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].kind, 'fix');
  assert.equal(fresh[0].source, 'gps');
  assert.equal(readDiagEvents(fresh[0].t + 3 * 60 * 60 * 1000).length, 0);
  flushDiag();
  const stored = JSON.parse(box.get('umap_diag_ring_v1'));
  assert.equal(stored[0].kind, 'fix');
  assert.equal(stored[0].source, 'gps');
  noteDiag({ kind: 'fix', lat: 37.2, lng: 127.3 });
  assert.equal(readDiagEvents().length, 2);
  clearDiag();
  assert.equal(readDiagEvents().length, 0);
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
