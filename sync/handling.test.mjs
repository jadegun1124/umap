import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createMemoryAccountStore } from './account.mjs';
import { handlingKey, listHandling, recordHandling } from './handling.mjs';
import { mintInvite, redeemInvite } from './invite.mjs';
import { handleSyncRequest, syncTokenFor } from './protocol.mjs';

function snapshot(memberId) {
  return {
    memberId,
    profileKey: 'profilekeyAAAAAAAA',
    profile: { name: '엄마', photo: null },
    room: { code: '48291', writeKey: 'writeKeyAAAAAAAAAA', readKey: 'readKeyAAAAAAAAAAA' },
    guardians: [],
    home: null,
    journeys: [],
    visits: [],
  };
}

async function accountCall(accounts, method, path, { body, accountKey, now } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (accountKey) headers.set('x-umap-account-key', accountKey);
  const response = await handleSyncRequest(null, new Request(`http://sync.local${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { accounts, now });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('collection is logged without coordinates and a removed member cannot read the family room', async () => {
  const accounts = createMemoryAccountStore();
  const created = await accountCall(accounts, 'POST', '/v1/account', { body: snapshot('local-handle1') });
  assert.equal(created.status, 200);
  const rooms = new Map();
  const store = {
    async read(token) { return rooms.get(token); },
    async write(token, value) { rooms.set(token, value); },
  };
  const token = await syncTokenFor('writeKeyAAAAAAAAAA', 'readKeyAAAAAAAAAAA');
  const profileKey = 'profilekeyAAAAAAAA';
  const at = Date.UTC(2026, 4, 2, 1, 0, 0);
  const published = await handleSyncRequest(store, new Request('http://sync.local/v1/rooms/48291/place', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-umap-sync-key': token, 'x-umap-profile-key': profileKey },
    body: JSON.stringify({
      code: '48291',
      name: '엄마',
      memberId: 'local-handle1',
      lat: 37.5,
      lng: 127.1,
      accuracyM: 5,
      at,
      sharing: true,
      audience: 'family',
    }),
  }), { accounts, now: at });
  assert.equal(published.status, 200);
  const recordId = await accounts.get('member:local-handle1');
  const chain = await accounts.get(handlingKey(recordId));
  assert.equal(chain.entries.length, 1);
  assert.equal(chain.entries[0].kind, 'collect');
  assert.equal(JSON.stringify(chain).includes('37.5'), false);

  const hidden = await handleSyncRequest(store, new Request('http://sync.local/v1/rooms/48291/family', {
    method: 'GET',
    headers: { 'x-umap-sync-key': token },
  }));
  assert.equal(hidden.status, 403);

  const seen = await handleSyncRequest(store, new Request('http://sync.local/v1/rooms/48291/family', {
    method: 'GET',
    headers: {
      'x-umap-sync-key': token,
      'x-umap-member': 'local-handle1',
      'x-umap-profile-key': profileKey,
    },
  }), { accounts, now: at });
  assert.equal(seen.status, 200);
  const listed = await listHandling(accounts, recordId, at);
  assert.equal(listed.events[0].kind, 'collect');

  for (const room of rooms.values()) {
    room.seals = { ...(room.seals || {}), revoked: ['local-handle1'] };
  }
  const blocked = await handleSyncRequest(store, new Request('http://sync.local/v1/rooms/48291/family', {
    method: 'GET',
    headers: {
      'x-umap-sync-key': token,
      'x-umap-member': 'local-handle1',
      'x-umap-profile-key': profileKey,
    },
  }));
  assert.equal(blocked.status, 403);
});

test('invite HTTP routes mint and redeem once', async () => {
  const accounts = createMemoryAccountStore();
  const now = Date.UTC(2026, 4, 2, 1, 0, 0);
  const token = await syncTokenFor('writeKeyAAAAAAAAAA', 'readKeyAAAAAAAAAAA');
  const minted = await accountCall(accounts, 'POST', '/v1/invites', {
    body: { code: '48291', syncToken: token, memberId: 'local-handle1' },
    now,
  });
  assert.equal(minted.status, 200);
  assert.equal(typeof minted.body.ticket, 'string');
  const redeemed = await accountCall(accounts, 'POST', `/v1/invites/${minted.body.ticket}/redeem`, { now });
  assert.equal(redeemed.status, 200);
  assert.equal(redeemed.body.syncToken, token);
  const again = await accountCall(accounts, 'POST', `/v1/invites/${minted.body.ticket}/redeem`, { now });
  assert.equal(again.status, 404);
});

test('an invite ticket works once and then expires', async () => {
  const accounts = createMemoryAccountStore();
  const now = Date.UTC(2026, 4, 2, 1, 0, 0);
  const token = await syncTokenFor('writeKeyAAAAAAAAAA', 'readKeyAAAAAAAAAAA');
  const minted = await mintInvite(accounts, { code: '48291', syncToken: token, memberId: 'local-handle1' }, now);
  assert.equal(minted.ok, true);
  const first = await redeemInvite(accounts, minted.ticket, now);
  assert.equal(first.ok, true);
  assert.equal(first.syncToken, token);
  const second = await redeemInvite(accounts, minted.ticket, now);
  assert.equal(second.error, 'invite');
  const later = await mintInvite(accounts, { code: '48291', syncToken: token, memberId: 'local-handle1' }, now);
  const expired = await redeemInvite(accounts, later.ticket, now + 24 * 60 * 60 * 1000);
  assert.equal(expired.error, 'expired');
});

test('cleartext location traffic is disabled on Android', () => {
  const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  const network = readFileSync(new URL('../android/app/src/main/res/xml/network_security_config.xml', import.meta.url), 'utf8');
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /network_security_config/);
  assert.match(network, /cleartextTrafficPermitted="false"/);
  const keep = readFileSync(new URL('../android/app/src/main/java/kr/co/umap/tracker/LocationKeepService.java', import.meta.url), 'utf8');
  assert.match(keep, /DeviceCipher\.seal/);
});

test('handling routes cannot be deleted', async () => {
  const accounts = createMemoryAccountStore();
  const created = await accountCall(accounts, 'POST', '/v1/account', { body: snapshot('local-handle2') });
  const recorded = await recordHandling(accounts, {
    kind: 'collect',
    memberId: 'local-handle2',
    actor: 'local-handle2',
    categories: ['location'],
    at: Date.UTC(2026, 4, 2, 1, 0, 0),
  }, Date.UTC(2026, 4, 2, 1, 0, 0));
  assert.equal(recorded.ok, true);
  const blocked = await accountCall(accounts, 'DELETE', '/v1/account/handling', { accountKey: created.body.account.accountKey });
  assert.equal(blocked.status, 405);
  const listed = await accountCall(accounts, 'GET', '/v1/account/handling', {
    accountKey: created.body.account.accountKey,
    now: Date.UTC(2026, 4, 2, 3, 0, 0),
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.events.length, 1);
  const again = await recordHandling(accounts, {
    kind: 'collect',
    memberId: 'local-handle2',
    actor: 'local-handle2',
    categories: ['location'],
    at: Date.UTC(2026, 4, 2, 2, 0, 0),
  }, Date.UTC(2026, 4, 2, 2, 0, 0));
  assert.equal(again.skipped, true);
  const recordId = await accounts.get('member:local-handle2');
  assert.equal((await accounts.get(handlingKey(recordId))).entries.length, 1);
  assert.equal(JSON.stringify(listed.body).includes('"lat"'), false);
});
