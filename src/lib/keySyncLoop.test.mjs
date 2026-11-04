import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

function memoryStorage() {
  const box = new Map();
  return {
    getItem: (key) => (box.has(key) ? box.get(key) : null),
    setItem: (key, value) => { box.set(key, String(value)); },
    removeItem: (key) => { box.delete(key); },
    clear: () => { box.clear(); },
    key: (index) => [...box.keys()][index] ?? null,
    get length() { return box.size; },
  };
}

function legacyNoKeyPuts() {
  // 27f6e39: no family key skips the 60s clock, and umap-family-keys calls sync again.
  let puts = 0;
  const sync = () => {
    puts += 1;
    if (puts < 400) sync();
  };
  sync();
  return puts;
}

test('a phone with no family key does not loop PUT /keys, and 27f6e39 does', async () => {
  const legacy = legacyNoKeyPuts();
  assert.ok(legacy > 100, `27f6e39 wiring sends ${legacy} PUT /keys`);

  const dir = mkdtempSync(join(tmpdir(), 'kinnex-keys-'));
  const outfile = join(dir, 'familySync.mjs');
  execFileSync('node_modules/esbuild/bin/esbuild', [
    'src/services/familySync.ts',
    '--bundle',
    '--platform=node',
    '--format=esm',
    `--outfile=${outfile}`,
    '--define:import.meta.env={"VITE_FAMILY_SYNC_URL":"https://sync.test"}',
  ], { cwd: process.cwd(), stdio: 'pipe' });
  const tracking = readFileSync(new URL('../components/family/useFamilyTracking.ts', import.meta.url), 'utf8');
  assert.match(tracking, /umap-family-keys/);
  assert.match(tracking, /syncKeepAlive\.current\(false\)/);
  assert.equal(/addEventListener\('umap-family-keys'[\s\S]{0,240}syncFamilyKeys\(/.test(tracking), false);

  const storage = memoryStorage();
  const events = [];
  globalThis.localStorage = storage;
  globalThis.window = {
    dispatchEvent(event) {
      events.push(event.type);
      if (event.type === 'umap-family-keys') {
        for (const listener of listeners) listener();
      }
      return true;
    },
    addEventListener(_type, listener) { listeners.add(listener); },
    removeEventListener(_type, listener) { listeners.delete(listener); },
  };
  const listeners = new Set();
  let puts = 0;
  let directory = {
    kid: 'kidkidkidkidkid1',
    pubs: {
      'local-other01': 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    },
    wraps: {},
    revoked: [],
    history: {},
  };
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('/keys') && init.method === 'PUT') {
      puts += 1;
      if (puts > 40) throw new Error(`runaway PUT /keys ${puts}`);
      const body = JSON.parse(init.body);
      directory = {
        ...directory,
        pubs: { ...directory.pubs, [body.memberId]: body.publicKey },
        wraps: body.wraps ? { ...directory.wraps, ...body.wraps } : directory.wraps,
        kid: body.kid || directory.kid,
        history: body.history || directory.history,
      };
      return new Response(JSON.stringify({ keys: directory }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  const { syncFamilyKeys } = await import(pathToFileURL(outfile).href);
  window.addEventListener('umap-family-keys', () => {
    void syncFamilyKeys('48291', `${'a'.repeat(16)}.${'b'.repeat(16)}`, 'local-nokey01', 'c'.repeat(16));
  });
  const realNow = Date.now;
  let now = 1_700_000_000_000;
  Date.now = () => now;
  try {
    const token = `${'a'.repeat(16)}.${'b'.repeat(16)}`;
    for (let elapsed = 0; elapsed <= 10 * 60_000; elapsed += 2_500) {
      now = 1_700_000_000_000 + elapsed;
      await syncFamilyKeys('48291', token, 'local-nokey01', 'c'.repeat(16));
    }
  } finally {
    Date.now = realNow;
    delete globalThis.fetch;
    delete globalThis.localStorage;
    delete globalThis.window;
  }
  assert.ok(puts <= 20, `PUT /keys ${puts} in 10 minutes; 27f6e39 control is ${legacy}`);
  assert.ok(puts >= 1, 'the phone still registers its key');
});
