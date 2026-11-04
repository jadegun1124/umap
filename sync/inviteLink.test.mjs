import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanAccountSnapshot, createMemoryAccountStore } from './account.mjs';
import { applyAccountSnapshot, snapshotFromSession } from '../src/lib/accountRestore.mjs';
import { handleSyncRequest, syncTokenFor } from './protocol.mjs';
import { ensureRoster } from '../src/lib/peerFamily.mjs';
import { buildGroupInviteLink, parseInviteUrl, syncTokenFromInviteFragment } from '../src/lib/inviteLink.mjs';

function snapshot(memberId, name) {
  return {
    memberId,
    profileKey: memberId.endsWith('a') ? 'profilekeyAAAAAAAA' : 'profilekeyBBBBBBBB',
    profile: { name, photo: null },
    room: { code: '48291', writeKey: 'writeKeyAAAAAAAAAA', readKey: 'readKeyAAAAAAAAAAA' },
    guardians: [],
    home: null,
    journeys: [],
    visits: [],
  };
}

async function call(accounts, method, path, { body, accountKey, now } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (accountKey) headers.set('x-umap-account-key', accountKey);
  const response = await handleSyncRequest({ async read() { return null; }, async write() {}, async delete() {} }, new Request(`http://sync.local${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { accounts, now });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}

test('a group link redeems the roster without sending the room key to the server', async () => {
  const accounts = createMemoryAccountStore();
  const now = 1_700_000_000_000;
  const created = await call(accounts, 'POST', '/v1/account', { body: snapshot('local-ownera', '엄마'), now });
  assert.equal(created.status, 200);
  const key = created.body.account.accountKey;
  const minted = await call(accounts, 'POST', '/v1/invites', {
    accountKey: key,
    now,
    body: { code: '48291', link: true },
  });
  assert.equal(minted.status, 200);
  const ticket = minted.body.ticket;
  const stored = await accounts.get(`invite:${ticket}`);
  assert.equal(stored.syncToken, undefined);
  assert.equal(stored.link, true);
  const token = await syncTokenFor('writeKeyAAAAAAAAAA', 'readKeyAAAAAAAAAAA');
  const link = buildGroupInviteLink('https://umap-family-sync.umap-jadegun.workers.dev', '48291', ticket, token);
  assert.equal(link.includes('#k='), true);
  assert.equal(new URL(link).search.includes(token), false);
  const opened = await handleSyncRequest({ async read() { return null; }, async write() {}, async delete() {} }, new Request(`http://sync.local/invite?code=48291&ticket=${ticket}`), { accounts, now });
  const page = await opened.text();
  assert.equal(opened.status, 200);
  assert.equal(page.includes(token), false);
  assert.equal(page.includes('syncToken'), false);
  assert.match(page, /location\.hash/);
  const redeemed = await call(accounts, 'POST', `/v1/invites/${ticket}/redeem`, { now, body: {} });
  assert.equal(redeemed.status, 200);
  assert.equal(redeemed.body.code, '48291');
  assert.equal(redeemed.body.syncToken, undefined);
  assert.equal(redeemed.body.ownerMemberId, 'local-ownera');
  assert.equal(syncTokenFromInviteFragment(new URL(link).hash), token);
  const appLink = `kinnex://invite?code=48291&ticket=${ticket}#k=${encodeURIComponent(token)}`;
  const parsed = parseInviteUrl(appLink);
  assert.equal(parsed.ticket, ticket);
  assert.equal(parsed.syncToken, token);
  const again = await call(accounts, 'POST', `/v1/invites/${ticket}/redeem`, { now, body: {} });
  assert.equal(again.status, 200);
  const revoked = await call(accounts, 'POST', `/v1/invites/${ticket}/revoke`, { accountKey: key, now, body: {} });
  assert.equal(revoked.status, 200);
  const after = await call(accounts, 'POST', `/v1/invites/${ticket}/redeem`, { now, body: {} });
  assert.equal(after.status, 410);
  const later = await call(accounts, 'POST', '/v1/invites', {
    accountKey: key,
    now,
    body: { code: '48291', link: true },
  });
  const expired = await call(accounts, 'POST', `/v1/invites/${later.body.ticket}/redeem`, { now: now + 8 * 24 * 60 * 60 * 1000, body: {} });
  assert.equal(expired.status, 410);

  const owner = { id: 'self', name: '엄마', role: 'self', publisherId: 'local-ownera' };
  const dad = { memberId: 'local-dadaaa', name: '아빠', at: now };
  const child = { memberId: 'local-child1', name: '아이', at: now };
  const roster = ensureRoster([owner], [{ memberId: 'local-ownera', name: '엄마', at: now }, dad, child], '48291', 'local-ownera');
  assert.equal(roster.joined.length, 2);
  assert.equal(roster.members.find((member) => member.id === 'self').lead, true);
  assert.equal(roster.members.find((member) => member.publisherId === 'local-dadaaa').lead, undefined);
  assert.equal(roster.members.some((member) => member.publisherId === 'local-child1'), true);
  const back = ensureRoster(roster.members, [{ memberId: 'local-joiner', name: '새가족', at: now }], '48291', 'local-ownera');
  assert.equal(back.members.some((member) => member.name === '새가족'), true);
  assert.equal(back.members.filter((member) => member.publisherId === 'local-dadaaa').length, 1);
  const removed = back.members.filter((member) => member.publisherId !== 'local-joiner');
  const hidden = ensureRoster(removed, [{ memberId: 'local-joiner', name: '새가족', at: now }], '48291', 'local-ownera', ['local-joiner', 'family:48291:local-joiner']);
  assert.equal(hidden.joined.length, 0);
  assert.equal(hidden.members.some((member) => member.publisherId === 'local-joiner'), false);
});

test('a joiner keeps the room owner id and the owner badge across backup', () => {
  const cleaned = cleanAccountSnapshot({
    memberId: 'local-joinera',
    profileKey: 'profilekeyBBBBBBBB',
    profile: { name: '새가족' },
    room: { code: '48291', writeKey: 'writeKeyAAAAAAAAAA', readKey: 'readKeyAAAAAAAAAAA' },
    guardians: [{ id: 'g-1', label: '엄마', code: '48291', share: 'accepted', ownerMemberId: 'local-ownera' }],
    roster: [{ id: 'family:48291:local-ownera', name: '엄마', role: 'admin-share', publisherId: 'local-ownera', lead: true }],
  });
  assert.equal(cleaned.snapshot.guardians[0].ownerMemberId, 'local-ownera');
  assert.equal(cleaned.snapshot.roster[0].lead, true);
  const dropped = cleanAccountSnapshot({
    memberId: 'local-joinera',
    profileKey: 'profilekeyBBBBBBBB',
    profile: { name: '새가족' },
    room: { code: '48291', writeKey: 'writeKeyAAAAAAAAAA', readKey: 'readKeyAAAAAAAAAAA' },
    guardians: [{ id: 'g-1', label: '엄마', code: '48291', share: 'accepted', ownerMemberId: 'mom' }],
  });
  assert.equal(dropped.snapshot.guardians[0].ownerMemberId, undefined);
  const session = {
    profile: { id: 'local-joinera', name: '새가족', profileKey: 'profilekeyBBBBBBBB' },
    inviteCode: '48291',
    syncWriteKey: 'writeKeyAAAAAAAAAA',
    syncReadKey: 'readKeyAAAAAAAAAAA',
    guardians: cleaned.snapshot.guardians,
    members: [
      { id: 'self', name: '새가족', role: 'self' },
      { id: 'family:48291:local-ownera', name: '엄마', role: 'admin-share', publisherId: 'local-ownera', lead: true },
    ],
  };
  const shot = snapshotFromSession(session);
  assert.equal(shot.guardians[0].ownerMemberId, 'local-ownera');
  assert.equal(shot.roster[0].lead, true);
  const restored = applyAccountSnapshot({ permissions: { completed: true } }, { ...cleaned.snapshot, ...shot });
  assert.equal(restored.guardians[0].ownerMemberId, 'local-ownera');
  assert.equal(restored.members.find((member) => member.publisherId === 'local-ownera').lead, true);
  assert.equal(restored.members.find((member) => member.id === 'self').lead, undefined);
});
