import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createMemoryAccountStore } from '../../sync/account.mjs';
import { handleSyncRequest, syncTokenFor } from '../../sync/protocol.mjs';
import { createMemoryStore } from '../../sync/protocol.mjs';
import { mintDeviceKey, mintFamilyKey, openJson, sealJson, unwrapFamilyKey, wrapFamilyKey } from './familySeal.mjs';
import { rosterMembers } from './peerFamily.mjs';
import { mergeFamilyRoster, missingWrapMemberIds, placeForFamilyRoster, rosterUnchanged } from './familyRosterSync.mjs';

const CODE = '48291';
const OWNER = 'local-ownera';
const JOINER = 'local-joinera';
const WRITE = 'writeKeyAAAAAAAAAA';
const READ = 'readKeyAAAAAAAAAAA';
const OWNER_PROFILE = 'profilekeyowneraaa';
const JOINER_PROFILE = 'profilekeyjoineraa';

function self(id, name) {
  return { id: 'self', name, role: 'self', publisherId: id, lat: 37.1, lng: 127.1, battery: 90, share: 'allowed' };
}

function profile(memberId, name, at = 1_700_000_000_000) {
  return { memberId, name, at };
}

function place(memberId, name, lat, lng, batteryPct, at) {
  return {
    code: CODE,
    name,
    memberId,
    audience: 'family',
    sharing: true,
    lat,
    lng,
    accuracyM: 12,
    at,
    batteryPct,
    charging: false,
  };
}

function card(members, memberId) {
  return members.find((member) => member.publisherId === memberId);
}

test('a place batch that omits coordinates does not drop the other person or clear a fix', () => {
  const invited = mergeFamilyRoster([self(OWNER, '엄마')], {
    code: CODE,
    profiles: [profile(JOINER, '아빠')],
    places: [],
    departed: [JOINER],
    selfId: OWNER,
    ownerId: '',
  });
  const named = card(invited.members, JOINER);
  assert.equal(named.name, '아빠');
  assert.deepEqual(invited.joined, ['아빠']);
  assert.equal(rosterMembers(invited.members, OWNER, CODE, '엄마').some((member) => member.publisherId === JOINER), true);

  const located = mergeFamilyRoster(invited.members, {
    code: CODE,
    profiles: [profile(JOINER, '아빠')],
    places: [place(JOINER, '아빠', 37.51, 127.04, 64, 1_700_000_003_000)],
    departed: [],
    selfId: OWNER,
    ownerId: '',
  });
  const dad = card(located.members, JOINER);
  assert.equal(dad.lat, 37.51);
  assert.equal(dad.lng, 127.04);
  assert.equal(dad.battery, 64);
  assert.equal(dad.lat == null, false);

  const omitted = mergeFamilyRoster(located.members, {
    code: CODE,
    profiles: [profile(JOINER, '아빠')],
    places: [],
    departed: [JOINER],
    selfId: OWNER,
    ownerId: '',
  });
  const kept = card(omitted.members, JOINER);
  assert.equal(kept.lat, 37.51);
  assert.equal(kept.lng, 127.04);
  assert.equal(kept.battery, 64);
  assert.deepEqual(omitted.joined, []);
  assert.equal(rosterUnchanged(located.members, omitted.members), true);
});

test('a profile that arrives with a fix still counts as a new join', () => {
  const arrived = mergeFamilyRoster([self(OWNER, '엄마')], {
    code: CODE,
    profiles: [profile(JOINER, '아빠')],
    places: [place(JOINER, '아빠', 37.51, 127.04, 64, 1_700_000_003_000)],
    selfId: OWNER,
    ownerId: '',
  });
  assert.equal(card(arrived.members, JOINER).lat, 37.51);
  assert.deepEqual(arrived.joined, ['아빠']);
  const again = mergeFamilyRoster(arrived.members, {
    code: CODE,
    profiles: [profile(JOINER, '아빠')],
    places: [place(JOINER, '아빠', 37.51, 127.04, 64, 1_700_000_003_000)],
    selfId: OWNER,
    ownerId: '',
  });
  assert.deepEqual(again.joined, []);
});

test('both phones show the other member with location and battery after redeem', () => {
  const ownerView = mergeFamilyRoster([self(OWNER, '엄마')], {
    code: CODE,
    profiles: [profile(JOINER, '아빠', 20)],
    places: [place(JOINER, '아빠', 37.55, 126.97, 81, 30)],
    selfId: OWNER,
    ownerId: '',
  });
  const joinerView = mergeFamilyRoster([self(JOINER, '아빠')], {
    code: CODE,
    profiles: [profile(OWNER, '엄마', 10)],
    places: [place(OWNER, '엄마', 37.48, 127.02, 47, 40)],
    selfId: JOINER,
    ownerId: OWNER,
  });
  const dad = card(ownerView.members, JOINER);
  const mom = card(joinerView.members, OWNER);
  assert.equal(dad.name, '아빠');
  assert.equal(dad.lat, 37.55);
  assert.equal(dad.battery, 81);
  assert.equal(mom.name, '엄마');
  assert.equal(mom.lat, 37.48);
  assert.equal(mom.battery, 47);
  assert.equal(mom.lead, true);
  assert.equal(rosterMembers(ownerView.members, OWNER, CODE, '엄마').some((member) => member.name === '아빠' && member.lat != null && member.battery === 81), true);
  assert.equal(rosterMembers(joinerView.members, JOINER, '10001', '아빠').some((member) => member.name === '엄마' && member.lat != null && member.battery === 47), true);

  const pending = place(JOINER, '아빠', null, null, 70, 50);
  const waiting = mergeFamilyRoster(ownerView.members, {
    code: CODE,
    profiles: [profile(JOINER, '아빠', 20)],
    places: [pending],
    selfId: OWNER,
  });
  const still = card(waiting.members, JOINER);
  assert.equal(still.lat, 37.55);
  assert.equal(still.battery, 70);
});

test('a sealed place keeps battery before the family key and location after it opens', async () => {
  const family = await mintFamilyKey();
  const seal = await sealJson(family.key, family.kid, { lat: 37.42, lng: 127.11, accuracyM: 9 });
  const envelope = {
    code: CODE,
    name: '엄마',
    memberId: OWNER,
    audience: 'family',
    sharing: true,
    lat: null,
    lng: null,
    accuracyM: 0,
    at: 80,
    batteryPct: 53,
    charging: true,
    seal,
  };
  const closed = placeForFamilyRoster(envelope, null);
  assert.equal(closed.lat, null);
  assert.equal(closed.batteryPct, 53);
  const nameOnly = mergeFamilyRoster([self(JOINER, '아빠')], {
    code: CODE,
    profiles: [profile(OWNER, '엄마')],
    places: [closed],
    selfId: JOINER,
    ownerId: OWNER,
  });
  assert.equal(card(nameOnly.members, OWNER).battery, 53);
  assert.equal(card(nameOnly.members, OWNER).lat, null);

  const opened = await openJson(family.key, seal);
  const live = placeForFamilyRoster(envelope, opened);
  assert.equal(live.lat, 37.42);
  assert.equal(live.batteryPct, 53);
  const filled = mergeFamilyRoster(nameOnly.members, {
    code: CODE,
    profiles: [profile(OWNER, '엄마')],
    places: [live],
    selfId: JOINER,
    ownerId: OWNER,
  });
  assert.equal(card(filled.members, OWNER).lat, 37.42);
  assert.equal(card(filled.members, OWNER).lng, 127.11);
  assert.equal(card(filled.members, OWNER).battery, 53);
  assert.equal(card(filled.members, OWNER).charging, true);
});

test('mint, redeem, then both family views carry the other person location and battery', async () => {
  const accounts = createMemoryAccountStore();
  const rooms = createMemoryStore();
  const now = Date.now();
  const headersFor = (token, profileKey, memberId) => ({ token, profileKey, member: memberId });
  async function call(method, path, { token, profileKey, member, accountKey, body } = {}) {
    const headers = new Headers({ 'content-type': 'application/json' });
    if (token) headers.set('x-umap-sync-key', token);
    if (profileKey) headers.set('x-umap-profile-key', profileKey);
    if (member) headers.set('x-umap-member', member);
    if (accountKey) headers.set('x-umap-account-key', accountKey);
    const response = await handleSyncRequest(rooms, new Request(`http://sync.local${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }), { accounts, now });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  const created = await call('POST', '/v1/account', {
    body: {
      memberId: OWNER,
      profileKey: OWNER_PROFILE,
      profile: { name: '엄마', photo: null },
      room: { code: CODE, writeKey: WRITE, readKey: READ },
      guardians: [],
      home: null,
      journeys: [],
      visits: [],
    },
  });
  assert.equal(created.status, 200);
  const minted = await call('POST', '/v1/invites', {
    accountKey: created.body.account.accountKey,
    body: { code: CODE, link: true },
  });
  assert.equal(minted.status, 200);
  const redeemed = await call('POST', `/v1/invites/${minted.body.ticket}/redeem`, { body: {} });
  assert.equal(redeemed.status, 200);
  assert.equal(redeemed.body.code, CODE);
  assert.equal(redeemed.body.ownerMemberId, OWNER);
  const token = await syncTokenFor(WRITE, READ);

  const ownerKeys = await mintDeviceKey();
  const joinerKeys = await mintDeviceKey();
  const family = await mintFamilyKey();
  const ownerWrap = await wrapFamilyKey(ownerKeys.publicKey, family.key, family.kid);
  const ownerPut = await call('PUT', `/v1/rooms/${CODE}/keys`, {
    ...headersFor(token, OWNER_PROFILE, OWNER),
    body: { memberId: OWNER, publicKey: ownerKeys.publicKey, kid: family.kid, wraps: { [OWNER]: ownerWrap }, rotate: true },
  });
  assert.equal(ownerPut.status, 200);
  const joinerPut = await call('PUT', `/v1/rooms/${CODE}/keys`, {
    ...headersFor(token, JOINER_PROFILE, JOINER),
    body: { memberId: JOINER, publicKey: joinerKeys.publicKey },
  });
  assert.equal(joinerPut.status, 200);
  const gap = missingWrapMemberIds(joinerPut.body.keys);
  assert.deepEqual(gap, [JOINER]);
  const joinerWrap = await wrapFamilyKey(joinerKeys.publicKey, family.key, family.kid);
  const wrapped = await call('PUT', `/v1/rooms/${CODE}/keys`, {
    ...headersFor(token, OWNER_PROFILE, OWNER),
    body: { memberId: OWNER, publicKey: ownerKeys.publicKey, kid: family.kid, wraps: { [JOINER]: joinerWrap } },
  });
  assert.equal(wrapped.status, 200);
  assert.equal(missingWrapMemberIds(wrapped.body.keys).length, 0);

  const ownerSeal = await sealJson(family.key, family.kid, { lat: 37.5, lng: 127.01, accuracyM: 8 });
  const joinerSeal = await sealJson(family.key, family.kid, { lat: 37.49, lng: 126.99, accuracyM: 11 });
  for (const [memberId, profileKey, name, seal, battery] of [
    [OWNER, OWNER_PROFILE, '엄마', ownerSeal, 44],
    [JOINER, JOINER_PROFILE, '아빠', joinerSeal, 73],
  ]) {
    const profilePut = await call('PUT', `/v1/rooms/${CODE}/profile`, {
      ...headersFor(token, profileKey, memberId),
      body: { memberId, name, at: now },
    });
    assert.equal(profilePut.status, 200);
    const placePut = await call('PUT', `/v1/rooms/${CODE}/place`, {
      ...headersFor(token, profileKey, memberId),
      body: {
        code: CODE,
        name,
        memberId,
        audience: 'family',
        sharing: true,
        lat: null,
        lng: null,
        accuracyM: 0,
        at: now + 5,
        batteryPct: battery,
        charging: false,
        seal,
      },
    });
    assert.equal(placePut.status, 200);
  }

  const ownerFamily = await call('GET', `/v1/rooms/${CODE}/family`, headersFor(token, OWNER_PROFILE, OWNER));
  const joinerFamily = await call('GET', `/v1/rooms/${CODE}/family`, headersFor(token, JOINER_PROFILE, JOINER));
  assert.equal(ownerFamily.status, 200);
  assert.equal(joinerFamily.status, 200);
  assert.equal(ownerFamily.body.profiles.some((item) => item.memberId === JOINER && item.name === '아빠'), true);
  assert.equal(joinerFamily.body.profiles.some((item) => item.memberId === OWNER && item.name === '엄마'), true);

  async function rosterFrom(view, selfId, ownerId) {
    const places = [];
    for (const item of view.places) {
      const key = await unwrapFamilyKey(selfId === OWNER ? ownerKeys.privateKey : joinerKeys.privateKey, view.keys.wraps[selfId], view.keys.kid);
      const opened = key ? await openJson(key, item.seal) : null;
      const usable = placeForFamilyRoster(item, opened);
      if (usable) places.push(usable);
    }
    return mergeFamilyRoster([self(selfId, selfId === OWNER ? '엄마' : '아빠')], {
      code: CODE,
      profiles: view.profiles,
      places,
      departed: view.departed,
      selfId,
      ownerId,
    });
  }

  const ownerRoster = await rosterFrom(ownerFamily.body, OWNER, '');
  const joinerRoster = await rosterFrom(joinerFamily.body, JOINER, OWNER);
  const seenJoiner = card(ownerRoster.members, JOINER);
  const seenOwner = card(joinerRoster.members, OWNER);
  assert.equal(seenJoiner.name, '아빠');
  assert.equal(seenJoiner.lat, 37.49);
  assert.equal(seenJoiner.battery, 73);
  assert.equal(seenOwner.name, '엄마');
  assert.equal(seenOwner.lat, 37.5);
  assert.equal(seenOwner.battery, 44);
  assert.equal(seenOwner.lead, true);
});

test('the map poll opens family keys before it drops a sealed place', () => {
  const sync = readFileSync(new URL('../services/familySync.ts', import.meta.url), 'utf8');
  const session = readFileSync(new URL('../components/family/session.tsx', import.meta.url), 'utf8');
  const managed = sync.slice(sync.indexOf('export function startManagedFamilySync'));
  const revealAt = managed.indexOf('await revealPlace(');
  assert.ok(revealAt > 0);
  assert.ok(managed.indexOf('absorbFamilyKeys(') < revealAt);
  assert.match(managed, /placeForFamilyRoster\(place, opened\)/);
  assert.equal(session.includes('!member.id.startsWith(prefix)'), false);
  assert.match(session, /mergeFamilyRoster\(/);
  assert.match(session, /profileIds/);
  const placeCase = session.slice(session.indexOf("case 'set-room-family-places'"), session.indexOf("case 'apply-canonical-trails'"));
  assert.match(placeCase, /withJoinNotices\([\s\S]*merged\.joined/);
  assert.match(session, /가족이 들어왔습니다/);
});
