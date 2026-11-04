import assert from 'node:assert/strict';
import test from 'node:test';
import { applyKeyPut, createMemoryStore, emptyRoom, handleSyncRequest, syncTokenFor } from './protocol.mjs';

test('a repeated family key upload does not rewrite the room', async () => {
  const store = createMemoryStore();
  let writes = 0;
  const counting = {
    read: (token) => store.read(token),
    write: async (token, room) => {
      writes += 1;
      await store.write(token, room);
    },
    delete: (token) => store.delete(token),
  };
  const token = await syncTokenFor('aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb');
  const profileKey = 'cccccccccccccccc';
  const body = {
    memberId: 'local-owner01',
    publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  };
  const request = () => new Request('http://sync.local/v1/rooms/81788/keys', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-umap-sync-key': token,
      'x-umap-profile-key': profileKey,
    },
    body: JSON.stringify(body),
  });
  const first = await handleSyncRequest(counting, request());
  assert.equal(first.status, 200);
  assert.equal(writes, 1);
  const second = await handleSyncRequest(counting, request());
  assert.equal(second.status, 200);
  const directory = await second.json();
  assert.equal(directory.keys.pubs['local-owner01'], body.publicKey);
  assert.equal(writes, 1);
});

test('repeated key puts inside the room limit write the directory once', async () => {
  const memory = new Map();
  const body = {
    memberId: 'local-owner01',
    publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  };
  const profileKey = 'cccccccccccccccc';
  const first = await applyKeyPut(emptyRoom(), body, profileKey, memory, 1_000);
  assert.equal(first.error, null);
  assert.equal(first.wrote, true);
  assert.equal(first.limited, false);
  const again = await applyKeyPut(first.room, { ...body, history: { 'local-owner01': {} } }, profileKey, memory, 20_000);
  assert.equal(again.wrote, false);
  assert.equal(again.limited, true);
  assert.equal(again.directory.pubs['local-owner01'], body.publicKey);
  const later = await applyKeyPut(first.room, body, profileKey, memory, 1_000 + 45_000);
  assert.equal(later.limited, false);
  assert.equal(later.wrote, false);
});
