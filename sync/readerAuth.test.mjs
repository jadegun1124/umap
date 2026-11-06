import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createMemoryStore, handleSyncRequest, syncTokenFor } from './protocol.mjs';

async function call(store, method, path, { token, readKey, profileKey, member, body, version } = {}) {
  const headers = new Headers();
  if (token) headers.set('x-umap-sync-key', token);
  if (readKey) headers.set('x-umap-read-key', readKey);
  if (profileKey) headers.set('x-umap-profile-key', profileKey);
  if (member) headers.set('x-umap-member', member);
  if (version) headers.set('x-app-version', version);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const response = await handleSyncRequest(store, new Request(`http://sync.local${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('a read-key room poll with no member header stays open after an owner exists', async () => {
  const store = createMemoryStore();
  const token = await syncTokenFor('a'.repeat(16), 'b'.repeat(16));
  const profile = 'c'.repeat(16);
  const code = '56638';
  const published = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    profileKey: profile,
    version: '1.73.0 79',
    body: {
      code,
      name: '엄마',
      memberId: 'local-mom0001',
      lat: 37.636,
      lng: 127.068,
      accuracyM: 12,
      at: Date.now(),
      sharing: true,
    },
  });
  assert.equal(published.status, 200);

  const anon = await call(store, 'GET', `/v1/rooms/${code}?since=1793190707993`, {
    token,
    readKey: 'b'.repeat(16),
  });
  assert.equal(anon.status, 200);
  assert.equal(anon.body.places.length, 1);
  assert.equal(anon.body.places[0].lat, 37.636);
  assert.equal(anon.body.places[0].client, '1.73.0 79');

  const wrong = await call(store, 'GET', `/v1/rooms/${code}?since=1793190707993`, {
    token,
    readKey: 'b'.repeat(16),
    member: 'local-mom0001',
    profileKey: 'd'.repeat(16),
  });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.error, 'profile-key');

  const family = await call(store, 'GET', `/v1/rooms/${code}/family`, { token });
  assert.equal(family.status, 403);

  const worker = readFileSync(new URL('./worker.mjs', import.meta.url), 'utf8');
  assert.match(worker, /readKeyProven: op\.readKeyProven === true/);
});
