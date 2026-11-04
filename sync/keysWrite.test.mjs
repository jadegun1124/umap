import assert from 'node:assert/strict';
import test from 'node:test';
import { KEY_PUT_BURST, applyKeyPut, createMemoryStore, emptyRoom, handleSyncRequest, syncTokenFor } from './protocol.mjs';

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

function wrapBytes(fill) {
  return {
    epk: Buffer.alloc(32, fill).toString('base64url'),
    iv: Buffer.alloc(12, fill).toString('base64url'),
    ct: Buffer.alloc(16, fill).toString('base64url'),
  };
}

test('a wrap uploaded after the public key is stored, then the window holds', async () => {
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
  const same = await applyKeyPut(first.room, body, profileKey, memory, 2_000);
  assert.equal(same.wrote, false);
  assert.equal(same.limited, false);
  const follow = await applyKeyPut(first.room, {
    ...body,
    kid: 'dddddddddddddddd',
    wraps: { 'local-owner01': wrapBytes(3) },
  }, profileKey, memory, 3_000);
  assert.equal(follow.limited, false);
  assert.equal(follow.wrote, true);
  assert.equal(follow.directory.wraps['local-owner01'].ct, wrapBytes(3).ct);
  let room = follow.room;
  let wrote = 2;
  for (let index = 0; index < 6; index += 1) {
    const next = await applyKeyPut(room, {
      ...body,
      kid: 'dddddddddddddddd',
      wraps: { 'local-owner01': wrapBytes(10 + index) },
    }, profileKey, memory, 4_000 + index);
    if (next.wrote) {
      wrote += 1;
      room = next.room;
    } else {
      assert.equal(next.limited, true);
      assert.equal(next.directory.pubs['local-owner01'], body.publicKey);
    }
  }
  assert.equal(wrote, KEY_PUT_BURST);
  const later = await applyKeyPut(room, {
    ...body,
    kid: 'eeeeeeeeeeeeeeee',
    wraps: { 'local-owner01': wrapBytes(9) },
    rotate: true,
  }, profileKey, memory, 1_000 + 45_000);
  assert.equal(later.limited, false);
  assert.equal(later.wrote, true);
  assert.equal(later.directory.kid, 'eeeeeeeeeeeeeeee');
});
