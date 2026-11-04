import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createMemoryAccountStore } from './account.mjs';
import { commitKeys, emptyRoom, handleSyncRequest } from './protocol.mjs';
import { applyAccountSnapshot } from '../src/lib/accountRestore.mjs';
import { openAccountSecrets, prepareBackup, syncHistoryDirectory } from '../src/lib/familyVault.mjs';
import { base64UrlToBytes, mintDeviceKey } from '../src/lib/familySeal.mjs';

const kakao = async () => ({ id: 123456789, kakao_account: { profile: { nickname: '엄마' } } });

function account(memberId, code, extra = {}) {
  return {
    memberId,
    profileKey: memberId.endsWith('a') ? 'profilekeyAAAAAAAA' : 'profilekeyBBBBBBBB',
    profile: { name: memberId.endsWith('a') ? '엄마' : '새폰', photo: null },
    room: {
      code,
      writeKey: memberId.endsWith('a') ? 'writeKeyAAAAAAAAAA' : 'writeKeyBBBBBBBBBB',
      readKey: memberId.endsWith('a') ? 'readKeyAAAAAAAAAAA' : 'readKeyBBBBBBBBBBB',
    },
    guardians: extra.guardians || [],
    home: extra.home || null,
    journeys: extra.journeys || [],
    visits: [],
  };
}

async function call(accounts, method, path, { body, accountKey, fetchKakaoUser } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (accountKey) headers.set('x-umap-account-key', accountKey);
  const response = await handleSyncRequest({ async read() { return null; }, async write() {}, async delete() {} }, new Request(`http://sync.local${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), {
    accounts,
    fetchKakaoUser: fetchKakaoUser || kakao,
    now: 1_700_000_000_000,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('kakao conflict can merge the old family into the current account once', async () => {
  const accounts = createMemoryAccountStore();
  const createdA = await call(accounts, 'POST', '/v1/account', {
    body: account('local-familya', '48291', {
      guardians: [{ code: '48291', label: '우리 집', syncToken: 'writeKeyAAAAAAAAAA.readKeyHashAAAAAAAA' }],
      home: { lat: 37.55, lng: 127.05, label: '우리 집' },
    }),
  });
  assert.equal(createdA.status, 200);
  const keyA = createdA.body.account.accountKey;
  const linkedA = await call(accounts, 'POST', '/v1/account/kakao', {
    accountKey: keyA,
    body: { accessToken: 'kakao-token', mode: 'link' },
  });
  assert.equal(linkedA.status, 200);
  assert.equal(linkedA.body.account.kakaoLinked, true);

  const sealed = { v: 1, alg: 'A256GCM', kid: 'a'.repeat(16), iv: 'A'.repeat(16), ct: 'B'.repeat(24) };
  const idA = await accounts.get('member:local-familya');
  const recordA = await accounts.get(`acct:${idA}`);
  recordA.sealedHistory = sealed;
  recordA.vault = { v: 1, salt: 'salt', iv: 'iviv', ct: 'vault-a' };
  await accounts.put(`acct:${idA}`, recordA);

  const createdB = await call(accounts, 'POST', '/v1/account', {
    body: account('local-freshbb', '10001'),
  });
  assert.equal(createdB.status, 200);
  const keyB = createdB.body.account.accountKey;
  const recoveryA = createdA.body.account.recoveryCode;
  const recoveryB = createdB.body.account.recoveryCode;
  assert.notEqual(recoveryA, recoveryB);

  const conflict = await call(accounts, 'POST', '/v1/account/kakao', {
    accountKey: keyB,
    body: { accessToken: 'kakao-token', mode: 'link' },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, 'member');

  const rejected = await call(accounts, 'POST', '/v1/account/kakao', {
    body: { accessToken: 'kakao-token', mode: 'link', merge: true },
  });
  assert.equal(rejected.status, 404);

  const badProof = await call(accounts, 'POST', '/v1/account/kakao', {
    accountKey: keyB,
    fetchKakaoUser: async () => null,
    body: { accessToken: 'nope', mode: 'link', merge: true },
  });
  assert.equal(badProof.status, 401);

  const merged = await call(accounts, 'POST', '/v1/account/kakao', {
    accountKey: keyB,
    body: { accessToken: 'kakao-token', mode: 'link', merge: true },
  });
  assert.equal(merged.status, 200);
  assert.equal(merged.body.account.memberId, 'local-freshbb');
  assert.equal(merged.body.account.room.code, '48291');
  assert.equal(merged.body.account.room.writeKey, 'writeKeyAAAAAAAAAA');
  assert.equal(merged.body.account.room.readKey, 'readKeyAAAAAAAAAAA');
  assert.equal(merged.body.account.home.label, '우리 집');
  assert.equal(merged.body.account.kakaoLinked, true);
  assert.equal(merged.body.account.mergedFrom, 'local-familya');
  assert.equal(merged.body.account.sealedHistory.ct, sealed.ct);
  assert.equal(merged.body.account.mergedVault.ct, 'vault-a');
  assert.equal(merged.body.account.vault, null);
  assert.equal(merged.body.account.recoveryCode, recoveryB);
  assert.notEqual(merged.body.account.memberId, 'local-familya');
  const adopted = applyAccountSnapshot({ permissions: { completed: true } }, {
    ...merged.body.account,
    roster: [
      { id: 'local-familya', name: '엄마', publisherId: 'local-familya' },
      { id: 'local-other01', name: '아빠', publisherId: 'local-other01' },
    ],
  });
  assert.deepEqual(adopted.hiddenMemberIds, ['local-familya']);
  assert.equal(adopted.members.some((member) => member.id === 'local-familya' || member.publisherId === 'local-familya'), false);
  assert.equal(adopted.members.some((member) => member.name === '아빠'), true);

  const again = await call(accounts, 'POST', '/v1/account/kakao', {
    accountKey: keyB,
    body: { accessToken: 'kakao-token', mode: 'link', merge: true },
  });
  assert.equal(again.status, 200);
  assert.equal(again.body.account.memberId, 'local-freshbb');
  assert.equal(await accounts.get('kakao:123456789'), await accounts.get('member:local-freshbb'));

  const login = await call(accounts, 'POST', '/v1/account/kakao', {
    body: { accessToken: 'kakao-token', mode: 'login' },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.account.memberId, 'local-freshbb');

  const old = await call(accounts, 'GET', '/v1/account', { accountKey: keyA });
  assert.equal(old.status, 200);
  assert.equal(old.body.account.kakaoLinked, false);
  assert.equal(old.body.account.memberId, 'local-familya');
  assert.equal(old.body.account.room.code, '48291');
  const oldRecord = await accounts.get(`acct:${idA}`);
  assert.equal(oldRecord.kakaoId, '');
  assert.equal(oldRecord.mergedInto, 'local-freshbb');
  const stillA = await call(accounts, 'POST', '/v1/account/recover', { body: { code: recoveryA } });
  assert.equal(stillA.status, 200);
  assert.equal(stillA.body.account.memberId, 'local-familya');
  assert.equal(stillA.body.account.kakaoLinked, false);
  const stillB = await call(accounts, 'POST', '/v1/account/recover', { body: { code: recoveryB } });
  assert.equal(stillB.status, 200);
  assert.equal(stillB.body.account.memberId, 'local-freshbb');
  assert.equal(stillB.body.account.kakaoLinked, true);

  const screen = readFileSync(new URL('../src/components/family/Onboarding.tsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/components/family/FamilyMapScreen.tsx', import.meta.url), 'utf8');
  assert.match(screen, /KakaoMergeSheet/);
  assert.match(screen, /linkKakaoAccount\([\s\S]*'link', true\)/);
  assert.match(settings, /KakaoMergeSheet/);
  assert.match(settings, /linkKakaoAccount\([\s\S]*'link', true\)/);
  assert.match(readFileSync(new URL('../src/components/family/KakaoMergeSheet.tsx', import.meta.url), 'utf8'), /서버는 열쇠와 기록을 풀지 않습니다/);
});

function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = value; },
    removeItem: (key) => { delete data[key]; },
  };
}

test('sealed history from the old account stays locked until a family device rewraps it', async () => {
  const owner = await mintDeviceKey();
  const mom = await mintDeviceKey();
  const phone = await mintDeviceKey();
  const sealed = await prepareBackup({
    memberId: 'local-familya',
    profileKey: 'profilekeyAAAAAAAA',
    profile: { name: '엄마', photo: null },
    room: { code: '48291', writeKey: 'writeKeyAAAAAAAAAA', readKey: 'readKeyAAAAAAAAAAA' },
    guardians: [],
    home: { label: '우리 집', address: '', lat: 37.55, lng: 127.05, radiusM: 150 },
    journeys: [{
      id: 'j-walk',
      startedAt: Date.now() - 60_000,
      endedAt: Date.now() - 30_000,
      distanceM: 180,
      points: [
        { lat: 37.55, lng: 127.05, at: Date.now() - 60_000 },
        { lat: 37.551, lng: 127.051, at: Date.now() - 30_000 },
      ],
      start: { lat: 37.55, lng: 127.05, label: '우리 집' },
      end: { lat: 37.551, lng: 127.051, label: '하계동' },
    }],
    visits: [],
  }, memoryStorage({ umap_seal_device_v1: JSON.stringify(owner) }), 'ABCDEFGHJKLN');

  let room = emptyRoom();
  room = (await commitKeys(room, { memberId: 'local-mom0001', publicKey: mom.publicKey }, 'profilekeymom000001')).room;
  room = (await commitKeys(room, { memberId: 'local-familya', publicKey: owner.publicKey }, 'profilekeyAAAAAAAA')).room;
  const published = await syncHistoryDirectory({
    history: room.seals.history,
    pubs: { ...room.seals.pubs, 'local-familya': owner.publicKey },
    memberId: 'local-familya',
    privateKey: owner.privateKey,
    contentKey: base64UrlToBytes(owner.contentKey),
  });
  room = (await commitKeys(room, {
    memberId: 'local-familya',
    publicKey: owner.publicKey,
    history: published.history,
  }, 'profilekeyAAAAAAAA')).room;

  const locked = await openAccountSecrets({
    memberId: 'local-freshbb',
    sealedHistory: sealed.sealedHistory,
    mergedVault: sealed.vault,
    journeys: [],
    visits: [],
  }, memoryStorage({ umap_seal_device_v1: JSON.stringify(phone) }), 'BBBBBBBBBBBB');
  assert.equal(locked.historyLocked, true);

  room = (await commitKeys(room, { memberId: 'local-freshbb', publicKey: phone.publicKey }, 'profilekeyBBBBBBBB')).room;
  const momOnline = await syncHistoryDirectory({
    history: room.seals.history,
    pubs: room.seals.pubs,
    memberId: 'local-mom0001',
    privateKey: mom.privateKey,
    contentKey: base64UrlToBytes(mom.contentKey),
  });
  const wrap = momOnline.history['local-familya'] && momOnline.history['local-familya']['local-freshbb'];
  assert.ok(wrap);
  const opened = await openAccountSecrets({
    memberId: 'local-freshbb',
    sealedHistory: sealed.sealedHistory,
    journeys: [],
    visits: [],
  }, memoryStorage({
    umap_seal_device_v1: JSON.stringify(phone),
    umap_history_share_v1: JSON.stringify({ memberId: 'local-freshbb', wrap }),
  }));
  assert.equal(opened.historyLocked, false);
  assert.equal(opened.home.label, '우리 집');
  assert.equal(opened.journeys[0].id, 'j-walk');

  const withCode = await openAccountSecrets({
    memberId: 'local-freshbb',
    sealedHistory: sealed.sealedHistory,
    mergedVault: sealed.vault,
    journeys: [],
    visits: [],
  }, memoryStorage({ umap_seal_device_v1: JSON.stringify(phone) }), 'ABCDEFGHJKLN');
  assert.equal(withCode.historyLocked, false);
  assert.equal(withCode.home.label, '우리 집');
});
