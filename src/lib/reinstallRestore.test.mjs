import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createMemoryAccountStore } from '../../sync/account.mjs';
import { commitKeys, createMemoryStore, emptyRoom, handleSyncRequest } from '../../sync/protocol.mjs';
import { accountNeedsDisplayName, applyAccountSnapshot, clearDeviceAccount } from './accountRestore.mjs';
import { HISTORY_SHARE_KID, openAccountSecrets, prepareBackup, rewrapHistoryShares, syncHistoryDirectory } from './familyVault.mjs';
import { mintDeviceKey, sealJson, unwrapFamilyKey, wrapFamilyKey } from './familySeal.mjs';
import { base64UrlToBytes, bytesToBase64Url } from './familySeal.mjs';

const KAKAO = {
  fetchKakaoUser: async () => ({ id: 123456789, kakao_account: { profile: { nickname: '엄마' } } }),
};

function freshPhone() {
  return {
    stage: 'login',
    profile: null,
    permissions: { completed: false },
    members: [],
    inviteCode: '10001',
    syncWriteKey: 'oldWriteKeyAAAAAAAA',
    syncReadKey: 'oldReadKeyAAAAAAAAA',
    journeys: {},
    visits: {},
    tracks: {},
    guardians: [],
  };
}

async function accountCall(accounts, method, path, body) {
  const response = await handleSyncRequest(createMemoryStore(), new Request(`http://sync.local${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), { accounts, ...KAKAO });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('kakao sign-in after uninstall restores the name, both members, and sealed history without onboarding', async () => {
  const owner = await mintDeviceKey();
  const peer = await mintDeviceKey();
  const content = base64UrlToBytes(owner.contentKey);
  const journey = {
    id: 'j-walk',
    startedAt: Date.now() - 60_000,
    endedAt: Date.now() - 30_000,
    distanceM: 240,
    points: [
      { lat: 37.55, lng: 127.05, at: Date.now() - 60_000 },
      { lat: 37.551, lng: 127.051, at: Date.now() - 30_000 },
    ],
    start: { lat: 37.55, lng: 127.05, label: '우리 집' },
    end: { lat: 37.551, lng: 127.051, label: '하계동' },
  };
  const sealedHistory = await sealJson(content, owner.publicKey, { journeys: [journey], visits: [], home: null });
  const peerShare = await wrapFamilyKey(peer.publicKey, content, HISTORY_SHARE_KID);
  const accounts = createMemoryAccountStore();
  const snapshot = {
    memberId: 'local-restore1',
    profileKey: 'profilekeyAAAAAAAA',
    profile: { name: '엄마', photo: null },
    room: { code: '48291', writeKey: 'writeKeyAAAAAAAAAA', readKey: 'readKeyAAAAAAAAAAA' },
    guardians: [],
    roster: [{ id: 'family:48291:local-peer01', name: 'Khoon', role: 'admin-share', publisherId: 'local-peer01', inviteCode: '48291' }],
    home: null,
    journeys: [],
    visits: [],
    vault: null,
    sealedHistory,
    historyShares: { 'local-peer01': peerShare },
  };
  const linked = await accountCall(accounts, 'POST', '/v1/account/kakao', {
    accessToken: 'kakao-access-ok',
    mode: 'link',
    snapshot,
  });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.account.kakaoLinked, true);

  const storage = new Map();
  const box = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, String(value)); },
    removeItem: (key) => { storage.delete(key); },
    get length() { return storage.size; },
    key: (index) => [...storage.keys()][index] || null,
  };
  box.setItem('umap_account_key_v1', 'left-on-the-old-phone');
  box.setItem('umap_seal_device_v1', JSON.stringify(owner));
  clearDeviceAccount(box, box);
  assert.equal(box.getItem('umap_seal_device_v1'), null);

  const again = await accountCall(accounts, 'POST', '/v1/account/kakao', {
    accessToken: 'kakao-access-ok',
    mode: 'login',
  });
  assert.equal(again.status, 200);
  assert.equal(again.body.restored, true);
  const account = { ...again.body.account, restored: true };
  assert.equal(accountNeedsDisplayName(account), false);
  const session = applyAccountSnapshot(freshPhone(), account);
  assert.equal(session.stage, 'map');
  assert.equal(session.profile.name, '엄마');
  assert.equal(session.members.some((member) => member.name === 'Khoon'), true);

  const replaced = await mintDeviceKey();
  let room = emptyRoom();
  const seeded = await commitKeys(room, {
    memberId: 'local-peer01',
    publicKey: peer.publicKey,
    history: { 'local-restore1': { 'local-peer01': peerShare } },
  }, 'profilekeyBBBBBBBB');
  assert.equal(seeded.error, null);
  const joined = await commitKeys(seeded.room, {
    memberId: 'local-restore1',
    publicKey: replaced.publicKey,
  }, 'profilekeyAAAAAAAA');
  assert.equal(joined.error, null);
  room = joined.room;
  const refreshed = await rewrapHistoryShares({
    history: room.seals.history,
    pubs: room.seals.pubs,
    holderId: 'local-peer01',
    holderPrivate: peer.privateKey,
  });
  const opened = await openAccountSecrets({
    ...account,
    historyShares: refreshed['local-restore1'],
  }, {
    getItem: (key) => (key === 'umap_seal_device_v1' ? JSON.stringify(replaced) : null),
    setItem() {},
  });
  assert.equal(opened.historyLocked, false);
  assert.equal(opened.journeys[0].id, 'j-walk');
});

function memoryStorage(initial = {}) {
  const storage = new Map(Object.entries(initial));
  return {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, String(value)); },
    removeItem: (key) => { storage.delete(key); },
    get length() { return storage.size; },
    key: (index) => [...storage.keys()][index] || null,
  };
}

test('a family phone rewraps history so Kakao login restores the name, family, and 우리 집 without a recovery code', async () => {
  const owner = await mintDeviceKey();
  const mom = await mintDeviceKey();
  const ownerBox = memoryStorage({ umap_seal_device_v1: JSON.stringify(owner) });
  const sealed = await prepareBackup({
    memberId: 'local-owner01',
    profileKey: 'profilekeyowner0001',
    profile: { name: '개발자', photo: null },
    room: { code: '48291', writeKey: 'writeKeyAAAAAAAAAA', readKey: 'readKeyAAAAAAAAAAA' },
    guardians: [],
    roster: [{ id: 'family:48291:local-mom0001', name: '엄마', role: 'admin-share', publisherId: 'local-mom0001', inviteCode: '48291' }],
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
  }, ownerBox, 'ABCDEFGHJKLN');
  assert.equal(sealed.historyShares, undefined);
  const accounts = createMemoryAccountStore();
  const linked = await accountCall(accounts, 'POST', '/v1/account/kakao', {
    accessToken: 'kakao-access-ok',
    mode: 'link',
    snapshot: sealed,
  });
  assert.equal(linked.status, 200);

  let room = emptyRoom();
  room = (await commitKeys(room, { memberId: 'local-mom0001', publicKey: mom.publicKey }, 'profilekeymom000001')).room;
  room = (await commitKeys(room, { memberId: 'local-owner01', publicKey: owner.publicKey }, 'profilekeyowner0001')).room;
  const ownerContent = base64UrlToBytes(owner.contentKey);
  const published = await syncHistoryDirectory({
    history: room.seals.history,
    pubs: { ...room.seals.pubs, 'local-owner01': owner.publicKey },
    memberId: 'local-owner01',
    privateKey: owner.privateKey,
    contentKey: ownerContent,
  });
  room = (await commitKeys(room, {
    memberId: 'local-owner01',
    publicKey: owner.publicKey,
    history: published.history,
  }, 'profilekeyowner0001')).room;
  assert.ok(room.seals.history['local-owner01']['local-mom0001'], 'owner publishes the history key to mom');

  clearDeviceAccount(ownerBox, ownerBox);
  const replaced = await mintDeviceKey();
  const again = await accountCall(accounts, 'POST', '/v1/account/kakao', {
    accessToken: 'kakao-access-ok',
    mode: 'login',
  });
  const account = { ...again.body.account, restored: true };
  assert.equal(accountNeedsDisplayName(account), false);
  const session = applyAccountSnapshot(freshPhone(), account);
  assert.equal(session.stage, 'map');
  assert.equal(session.profile.name, '개발자');
  assert.equal(session.members.some((member) => member.name === '엄마'), true);
  assert.equal(session.historyLocked || !session.home, true);

  room = (await commitKeys(room, {
    memberId: 'local-owner01',
    publicKey: replaced.publicKey,
  }, 'profilekeyowner0001')).room;
  const early = await syncHistoryDirectory({
    history: room.seals.history,
    pubs: room.seals.pubs,
    memberId: 'local-owner01',
    privateKey: replaced.privateKey,
    contentKey: base64UrlToBytes(replaced.contentKey),
  });
  const kept = await unwrapFamilyKey(mom.privateKey, early.history['local-owner01']['local-mom0001'], HISTORY_SHARE_KID);
  assert.equal(bytesToBase64Url(kept), bytesToBase64Url(ownerContent));
  const momOnline = await syncHistoryDirectory({
    history: room.seals.history,
    pubs: room.seals.pubs,
    memberId: 'local-mom0001',
    privateKey: mom.privateKey,
    contentKey: base64UrlToBytes(mom.contentKey),
  });
  room = (await commitKeys(room, {
    memberId: 'local-mom0001',
    publicKey: mom.publicKey,
    history: momOnline.history,
  }, 'profilekeymom000001')).room;
  const ownerOnline = await syncHistoryDirectory({
    history: room.seals.history,
    pubs: room.seals.pubs,
    memberId: 'local-owner01',
    privateKey: replaced.privateKey,
    contentKey: base64UrlToBytes(replaced.contentKey),
  });
  const opened = await openAccountSecrets({
    ...account,
    historyShares: ownerOnline.history['local-owner01'],
  }, memoryStorage({ umap_seal_device_v1: JSON.stringify(replaced) }));
  assert.equal(opened.historyLocked, false);
  assert.equal(opened.journeys[0].id, 'j-walk');
  assert.equal(opened.home.label, '우리 집');
  assert.equal(readFileSync(new URL('../components/family/FamilyMapScreen.tsx', import.meta.url), 'utf8').includes('가족 폰에서 Kinnex를 열면 지난 기록이 자동으로 돌아옵니다'), true);
  assert.equal(bytesToBase64Url(ownerContent).length > 0, true);
});

test('recovery uses the same restored flag so a named account skips the name screen', () => {
  const source = readFileSync(new URL('../components/family/Onboarding.tsx', import.meta.url), 'utf8');
  assert.match(source, /finishAccount\(\{ \.\.\.result\.account, restored: result\.restored === true \}/);
  assert.equal(accountNeedsDisplayName({ restored: true, nameChosen: false, profile: { name: '엄마' } }), false);
  assert.equal(accountNeedsDisplayName({ nameChosen: false, profile: { name: '엄마' } }), true);
});
