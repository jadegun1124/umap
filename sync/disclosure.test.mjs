import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createMemoryAccountStore } from './account.mjs';
import {
  disclosureExpiresAt,
  disclosureKey,
  discloseToThirdParty,
  listDisclosures,
  releaseToThirdParty,
  verifyDisclosureChain,
} from './disclosure.mjs';
import { handleSyncRequest } from './protocol.mjs';

const AT = Date.UTC(2026, 4, 2, 1, 0, 0);
const RANGE_START = Date.UTC(2026, 4, 1, 0, 0, 0);
const RANGE_END = Date.UTC(2026, 4, 1, 9, 0, 0);

function snapshot(memberId, code) {
  return {
    memberId,
    profileKey: 'profilekeyAAAAAAAA',
    profile: { name: '엄마', photo: null },
    room: { code, writeKey: 'writeKeyAAAAAAAAAA', readKey: 'readKeyAAAAAAAAAAA' },
    guardians: [],
    home: null,
    journeys: [],
    visits: [],
  };
}

function sealedPayload() {
  return { v: 1, alg: 'A256GCM', kid: 'kidkidkidkidkidk', iv: 'aaaaaaaaaaaa', ct: 'ciphertextvalue' };
}

function requestFor(memberId, extra = {}) {
  return {
    memberId,
    audience: 'third-party',
    categories: ['location'],
    rangeStart: RANGE_START,
    rangeEnd: RANGE_END,
    recipient: '개인정보 열람',
    purpose: '열람 청구',
    actor: '운영자',
    at: AT,
    payload: sealedPayload(),
    ...extra,
  };
}

async function accountCall(accounts, method, path, { body, accountKey, now } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (accountKey) headers.set('x-umap-account-key', accountKey);
  const request = new Request(`http://sync.local${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handleSyncRequest(null, request, { accounts, now });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function ledgerId(accounts, memberId) {
  const id = await accounts.get(`member:${memberId}`);
  if (typeof id !== 'string') throw new Error(`missing ledger for ${memberId}`);
  return id;
}

async function register(accounts, memberId = 'local-restore1', code = '48291') {
  const created = await accountCall(accounts, 'POST', '/v1/account', { body: snapshot(memberId, code), now: AT });
  assert.equal(created.status, 200);
  return created.body.account;
}

test('six calendar months is the disclosure retention', () => {
  assert.equal(disclosureExpiresAt(Date.UTC(2026, 0, 15, 3, 4, 5)), Date.UTC(2026, 6, 15, 3, 4, 5));
  assert.equal(disclosureExpiresAt(Date.UTC(2024, 1, 29, 0, 0, 0)), Date.UTC(2024, 7, 29, 0, 0, 0));
  assert.equal(disclosureExpiresAt(Date.UTC(2026, 7, 31, 8, 0, 0)), Date.UTC(2027, 1, 28, 8, 0, 0));
});

test('release appends a hash chain and refuses coordinates or family audience', async () => {
  const accounts = createMemoryAccountStore();
  const account = await register(accounts);
  const key = disclosureKey(await ledgerId(accounts, account.memberId));
  assert.equal(await accounts.get(key), undefined);

  const family = await releaseToThirdParty(accounts, requestFor(account.memberId, { audience: 'family' }), AT);
  assert.equal(family.error, 'audience');
  assert.equal(family.released, undefined);
  assert.equal(await accounts.get(key), undefined);

  const kin = await releaseToThirdParty(accounts, requestFor(account.memberId, { recipient: '가족' }), AT);
  assert.equal(kin.error, 'recipient');
  assert.equal(await accounts.get(key), undefined);

  const coords = await releaseToThirdParty(accounts, requestFor(account.memberId, {
    payload: { note: 'sealed', point: { lat: 37.6, lng: 127.1 } },
  }), AT);
  assert.equal(coords.error, 'coordinates');
  assert.equal(coords.released, undefined);
  assert.equal(await accounts.get(key), undefined);

  const hidden = await releaseToThirdParty(accounts, requestFor(account.memberId, {
    payload: { body: '{"lat": 37.6, "lng": 127.1}' },
  }), AT);
  assert.equal(hidden.error, 'coordinates');
  assert.equal(await accounts.get(key), undefined);

  const first = await releaseToThirdParty(accounts, requestFor(account.memberId), AT);
  assert.equal(first.ok, true);
  assert.equal(first.released.ct, 'ciphertextvalue');
  assert.equal(first.entry.recipient, '개인정보 열람');
  assert.equal(JSON.stringify(first.entry).includes('ciphertextvalue'), false);
  assert.equal(JSON.stringify(first.entry).includes('"lat"'), false);

  const second = await discloseToThirdParty(accounts, requestFor(account.memberId, {
    categories: ['history'],
    at: AT + 60 * 60 * 1000,
    purpose: '자료 제출',
  }), AT + 60 * 60 * 1000);
  assert.equal(second.ok, true);
  const stored = await accounts.get(key);
  assert.equal(stored.entries.length, 2);
  assert.equal(stored.entries[0].prevHash, '');
  assert.equal(stored.entries[1].prevHash, stored.entries[0].hash);
  assert.equal(await verifyDisclosureChain(stored), true);
  assert.equal(JSON.stringify(stored).includes('ciphertextvalue'), false);
  assert.equal(JSON.stringify(stored).includes('"lat"'), false);

  stored.entries[0].purpose = '바뀐 이유';
  await accounts.put(key, stored);
  const tampered = await listDisclosures(accounts, await ledgerId(accounts, account.memberId), AT + 60 * 60 * 1000);
  assert.equal(tampered.intact, false);
  assert.equal(tampered.disclosures.length, 2);
  assert.equal(JSON.stringify(tampered.disclosures).includes('"lat"'), false);
  const blocked = await releaseToThirdParty(accounts, requestFor(account.memberId, {
    at: AT + 2 * 60 * 60 * 1000,
    purpose: '추가 제출',
  }), AT + 2 * 60 * 60 * 1000);
  assert.equal(blocked.error, 'chain');
  assert.equal((await accounts.get(key)).entries.length, 2);
});

test('normal API calls cannot delete entries, and another account cannot read them', async () => {
  const accounts = createMemoryAccountStore();
  const owner = await register(accounts);
  const other = await register(accounts, 'local-restore2', '10002');
  const released = await releaseToThirdParty(accounts, requestFor(owner.memberId), AT);
  assert.equal(released.ok, true);
  const before = JSON.stringify(await accounts.get(disclosureKey(await ledgerId(accounts, owner.memberId))));

  for (const method of ['DELETE', 'POST', 'PUT']) {
    const blocked = await accountCall(accounts, method, '/v1/account/disclosures', {
      accountKey: owner.accountKey,
      body: { memberId: owner.memberId },
      now: AT,
    });
    assert.equal(blocked.status, 405);
    assert.equal(blocked.body.error, 'method');
  }
  assert.equal(JSON.stringify(await accounts.get(disclosureKey(await ledgerId(accounts, owner.memberId)))), before);

  const own = await accountCall(accounts, 'GET', '/v1/account/disclosures', {
    accountKey: owner.accountKey,
    now: AT,
  });
  assert.equal(own.status, 200);
  assert.equal(own.body.ok, true);
  assert.equal(own.body.intact, true);
  assert.equal(own.body.retentionMonths, 6);
  assert.equal(own.body.disclosures.length, 1);
  assert.equal(own.body.disclosures[0].actor, '운영자');
  assert.deepEqual(own.body.disclosures[0].categories, ['location']);
  assert.equal(JSON.stringify(own.body).includes('"lat"'), false);
  assert.equal(JSON.stringify(own.body).includes('ciphertextvalue'), false);

  const stranger = await accountCall(accounts, 'GET', '/v1/account/disclosures', {
    accountKey: other.accountKey,
    now: AT,
  });
  assert.equal(stranger.status, 200);
  assert.deepEqual(stranger.body.disclosures, []);
});

test('withdrawal keeps unexpired disclosure metadata and drops it after six months', async () => {
  const accounts = createMemoryAccountStore();
  const owner = await register(accounts);
  const first = await releaseToThirdParty(accounts, requestFor(owner.memberId), AT);
  const later = AT + 60 * 60 * 1000;
  const second = await releaseToThirdParty(accounts, requestFor(owner.memberId, {
    categories: ['place'],
    at: later,
    purpose: '자료 제출',
  }), later);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const recordId = await accounts.get(`member:${owner.memberId}`);

  const withdrawn = await accountCall(accounts, 'DELETE', '/v1/account', {
    accountKey: owner.accountKey,
    now: later,
  });
  assert.equal(withdrawn.status, 200);
  assert.equal(await accounts.get(`acct:${recordId}`), undefined);
  const kept = await accounts.get(disclosureKey(recordId));
  assert.equal(kept.entries.length, 2);
  assert.equal(kept.entries[0].recipient, '개인정보 열람');

  const expiredAt = disclosureExpiresAt(AT);
  const listed = await listDisclosures(accounts, recordId, expiredAt);
  assert.equal(listed.disclosures.length, 1);
  assert.deepEqual(listed.disclosures[0].categories, ['place']);
  assert.equal(listed.intact, true);
  const trimmed = await accounts.get(disclosureKey(recordId));
  assert.equal(trimmed.entries.length, 1);
  assert.equal(trimmed.entries[0].prevHash, trimmed.anchor);
  assert.equal(trimmed.anchor, kept.entries[0].hash);
  assert.notEqual(trimmed.entries[0].purpose, kept.entries[0].purpose);

  const stillThere = disclosureExpiresAt(later);
  const other = await register(accounts, 'local-restore3', '10003');
  const swept = await accountCall(accounts, 'GET', '/v1/account', {
    accountKey: other.accountKey,
    now: stillThere,
  });
  assert.equal(swept.status, 200);
  assert.equal(await accounts.get(disclosureKey(recordId)), undefined);
  const gone = await listDisclosures(accounts, recordId, stillThere);
  assert.deepEqual(gone.disclosures, []);
});

test('a new account with the same member id cannot read a withdrawn ledger', async () => {
  const accounts = createMemoryAccountStore();
  const owner = await register(accounts);
  const released = await releaseToThirdParty(accounts, requestFor(owner.memberId), AT);
  assert.equal(released.ok, true);
  const recordId = await ledgerId(accounts, owner.memberId);
  const removed = await accountCall(accounts, 'DELETE', '/v1/account', { accountKey: owner.accountKey, now: AT });
  assert.equal(removed.status, 200);
  const again = await register(accounts);
  assert.notEqual(await ledgerId(accounts, again.memberId), recordId);
  const seen = await accountCall(accounts, 'GET', '/v1/account/disclosures', { accountKey: again.accountKey, now: AT });
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.body.disclosures, []);
  const kept = await accounts.get(disclosureKey(recordId));
  assert.equal(kept.entries.length, 1);
  assert.equal(kept.entries[0].recipient, '개인정보 열람');
});

test('a disclosure lists every personal-data category and stores none of the values', async () => {
  const accounts = createMemoryAccountStore();
  const account = await register(accounts);
  const payload = {
    profile: { name: '엄마' },
    kakaoId: '123456789',
    naverId: 'naver-user-88',
    guardians: [{ memberId: 'local-otherphone' }],
    deviceId: 'pixel-8',
    profileKey: 'profilekeyAAAAAAAA',
    photo: 'profile-photo',
  };
  const missing = await releaseToThirdParty(accounts, requestFor(account.memberId, {
    categories: ['name'],
    payload,
  }), AT);
  assert.equal(missing.error, 'category');
  assert.equal(missing.released, undefined);
  assert.equal(await accounts.get(disclosureKey(await ledgerId(accounts, account.memberId))), undefined);

  const unnamed = await releaseToThirdParty(accounts, requestFor(account.memberId, {
    categories: ['name', 'kakao', 'naver', 'family', 'device', 'account'],
    payload,
  }), AT);
  assert.equal(unnamed.error, 'category');

  const released = await releaseToThirdParty(accounts, requestFor(account.memberId, {
    categories: ['device', 'kakao', 'name', 'other', 'account', 'family', 'naver'],
    detail: '프로필 사진',
    payload,
  }), AT);
  assert.equal(released.ok, true);
  assert.deepEqual(released.entry.categories, ['name', 'kakao', 'naver', 'family', 'device', 'account', 'other']);
  assert.equal(released.entry.detail, '프로필 사진');
  assert.equal(released.released.kakaoId, '123456789');
  const stored = JSON.stringify(await accounts.get(disclosureKey(await ledgerId(accounts, account.memberId))));
  assert.equal(stored.includes('123456789'), false);
  assert.equal(stored.includes('naver-user-88'), false);
  assert.equal(stored.includes('pixel-8'), false);
  assert.equal(stored.includes('profilekeyAAAAAAAA'), false);
  assert.equal(stored.includes('엄마'), false);
  assert.equal(stored.includes('프로필 사진'), true);

  const secretDetail = await releaseToThirdParty(accounts, requestFor(account.memberId, {
    categories: ['other'],
    detail: 'profilekeyAAAAAAAA',
    payload: { photo: 'x' },
    at: AT + 1000,
    purpose: '추가 열람',
  }), AT + 1000);
  assert.equal(secretDetail.error, 'category');
});

test('a seal object cannot hide another personal field', async () => {
  const accounts = createMemoryAccountStore();
  const account = await register(accounts);
  const payload = {
    ...sealedPayload(),
    kakaoId: '123456789',
  };
  const hidden = await releaseToThirdParty(accounts, requestFor(account.memberId, {
    categories: ['location'],
    payload,
  }), AT);
  assert.equal(hidden.error, 'category');
  assert.equal(hidden.released, undefined);
  assert.equal(await accounts.get(disclosureKey(await ledgerId(accounts, account.memberId))), undefined);
  const listed = await releaseToThirdParty(accounts, requestFor(account.memberId, {
    categories: ['location', 'kakao'],
    payload,
  }), AT);
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.entry.categories, ['kakao', 'location']);
  assert.equal(JSON.stringify(await accounts.get(disclosureKey(await ledgerId(accounts, account.memberId)))).includes('123456789'), false);
});

test('only releaseToThirdParty writes the disclosure chain', () => {
  const account = readFileSync(new URL('./account.mjs', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('./worker.mjs', import.meta.url), 'utf8');
  const protocol = readFileSync(new URL('./protocol.mjs', import.meta.url), 'utf8');
  const disclosure = readFileSync(new URL('./disclosure.mjs', import.meta.url), 'utf8');
  assert.equal(account.includes('releaseToThirdParty'), false);
  assert.equal(account.includes('discloseToThirdParty'), false);
  assert.equal(worker.includes('disclosure:'), false);
  assert.equal(protocol.includes('disclosure:'), false);
  assert.match(account, /purgeExpiredDisclosures/);
  assert.match(disclosure, /export async function releaseToThirdParty/);
  assert.match(disclosure, /export const discloseToThirdParty = releaseToThirdParty/);
  assert.equal(disclosure.includes('store.delete(disclosureKey'), true);
});