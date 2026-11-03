import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryStore, handleSyncRequest, syncTokenFor } from './protocol.mjs';

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
