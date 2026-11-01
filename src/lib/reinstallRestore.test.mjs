import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryAccountStore } from '../../sync/account.mjs';
import { commitKeys, createMemoryStore, emptyRoom, handleSyncRequest } from '../../sync/protocol.mjs';
import { accountNeedsDisplayName, applyAccountSnapshot, clearDeviceAccount } from './accountRestore.mjs';
import { HISTORY_SHARE_KID, openAccountSecrets, rewrapHistoryShares } from './familyVault.mjs';
import { mintDeviceKey, sealJson, wrapFamilyKey } from './familySeal.mjs';
import { base64UrlToBytes } from './familySeal.mjs';

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
