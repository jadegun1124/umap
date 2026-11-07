import assert from 'node:assert/strict';
import test from 'node:test';
import { clearDiag, fixChannelSource, noteDiag, readDiagEvents } from './diagLog.mjs';

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
  const stored = JSON.parse(box.get('umap_diag_ring_v1'));
  stored[0].t = Date.now() - 3 * 60 * 60 * 1000;
  box.set('umap_diag_ring_v1', JSON.stringify(stored));
  assert.equal(readDiagEvents().length, 0);
  noteDiag({ kind: 'fix', lat: 37.2, lng: 127.3 });
  assert.equal(readDiagEvents().length, 1);
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
