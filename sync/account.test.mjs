import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMemoryAccountStore,
  formatRecoveryCode,
  normalizeRecoveryCode,
  parseAccountOperation,
  publicAccount,
  sameMember,
} from './account.mjs';
import { NAVER_APP_REDIRECT } from '../src/lib/naverAuth.mjs';
import { createMemoryStore, emptyRoom, handleSyncRequest, memberRoomToken, randomKey, syncTokenFor } from './protocol.mjs';
import {
  ACCOUNT_KEY_STORAGE,
  ACCOUNT_LINKS_STORAGE,
  RECOVERY_CODE_STORAGE,
  accountNeedsDisplayName,
  interpretAccountDelete,
  applyAccountSnapshot,
  clearDeviceAccount,
  currentAccountBackupEpoch,
  logoutLocalAccount,
  persistAccountSecretsIfCurrent,
  readStoredAccountLinks,
  rememberAccountSecrets,
  snapshotFromSession,
  writeStoredAccountKey,
  writeStoredRecoveryCode,
} from '../src/lib/accountRestore.mjs';

const LEFTOVER_GOOGLE_ACCOUNT_KEY = 'umap_google_account_v1';

function snapshot(overrides = {}) {
  return {
    memberId: 'local-restore1',
    profileKey: 'profilekeyAAAAAAAA',
    profile: { name: '엄마', photo: null },
    room: { code: '48291', writeKey: 'writeKeyAAAAAAAAAA', readKey: 'readKeyAAAAAAAAAAA' },
    guardians: [],
    home: null,
    journeys: [{
      id: 'j-1',
      startedAt: Date.now() - 3_600_000,
      endedAt: Date.now() - 3_000_000,
      distanceM: 900,
      points: [
        { lat: 37.6365, lng: 127.0680, at: Date.now() - 3_600_000 },
        { lat: 37.6370, lng: 127.0690, at: Date.now() - 3_000_000 },
      ],
      start: { lat: 37.6365, lng: 127.0680, label: '하계1차청구아파트 104동' },
      end: { lat: 37.6370, lng: 127.0690, label: '하계동' },
    }],
    visits: [{
      id: 'v-1',
      lat: 37.6365,
      lng: 127.0680,
      arrivedAt: Date.now() - 3_600_000,
      leftAt: Date.now() - 3_000_000,
      label: '하계1차청구아파트 104동',
      source: 'geocode',
    }],
    ...overrides,
  };
}

async function accountCall(accounts, method, path, { body, accountKey, extras, rooms } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (accountKey) headers.set('x-umap-account-key', accountKey);
  const request = new Request(`http://sync.local${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const roomStore = rooms || createMemoryStore();
  const response = await handleSyncRequest(roomStore, request, {
    accounts,
    fetchKakaoUser: extras?.fetchKakaoUser,
    fetchNaverUser: extras?.fetchNaverUser,
    exchangeNaverCode: extras?.exchangeNaverCode,
    naverClientId: extras?.naverClientId,
    naverClientSecret: extras?.naverClientSecret,
    naverAccessToken: extras?.naverAccessToken,
    kakaoAdminKey: extras?.kakaoAdminKey,
    unlinkKakao: extras?.unlinkKakao,
    revokeNaver: extras?.revokeNaver,
    now: extras?.now,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('recovery code is 12 characters and restores the same member', async () => {
  const accounts = createMemoryAccountStore();
  const created = await accountCall(accounts, 'POST', '/v1/account', { body: snapshot() });
  assert.equal(created.status, 200);
  assert.equal(created.body.account.memberId, 'local-restore1');
  const code = normalizeRecoveryCode(created.body.account.recoveryCode);
  assert.equal(code.length, 12);
  assert.equal(formatRecoveryCode(code), created.body.account.recoveryCode);

  const recovered = await accountCall(accounts, 'POST', '/v1/account/recover', { body: { code } });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.restored, true);
  assert.equal(recovered.body.account.memberId, 'local-restore1');
  assert.equal(recovered.body.account.room.code, '48291');
  assert.equal(recovered.body.account.journeys[0].id, 'j-1');
  assert.equal(sameMember(created.body.account, recovered.body.account), true);

  const missing = await accountCall(accounts, 'POST', '/v1/account/recover', { body: { code: 'ABCD-EFGH-IJKL' } });
  assert.equal(missing.status, 403);
});

test('Google login route is closed and leftover googleSub still recovers', async () => {
  const accounts = createMemoryAccountStore();
  const closed = await accountCall(accounts, 'POST', '/v1/account/google', {
    body: { idToken: 'unused' },
  });
  assert.equal(closed.status, 404);
  assert.equal(closed.body.error, 'method');

  const created = await accountCall(accounts, 'POST', '/v1/account', { body: snapshot() });
  assert.equal(created.status, 200);
  const recordId = await accounts.get('member:local-restore1');
  const record = await accounts.get(`acct:${recordId}`);
  record.googleSub = '1098234765';
  await accounts.put(`acct:${recordId}`, record);
  await accounts.put('google:1098234765', recordId);

  const recovered = await accountCall(accounts, 'POST', '/v1/account/recover', {
    body: { code: created.body.account.recoveryCode },
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.account.memberId, 'local-restore1');
  assert.equal(recovered.body.account.googleLinked, true);
  assert.equal(recovered.body.account.kakaoLinked, false);

  const rooms = createMemoryStore();
  const writeKey = randomKey();
  const readKey = randomKey();
  const token = await syncTokenFor(writeKey, readKey);
  const code = '48291';
  const place = {
    code,
    name: '엄마',
    lat: 37.6365,
    lng: 127.0680,
    accuracyM: 12,
    at: Date.now(),
    sharing: true,
    audience: 'family',
    memberId: recovered.body.account.memberId,
  };
  const headers = { 'content-type': 'application/json', 'x-umap-sync-key': token, 'x-umap-profile-key': recovered.body.account.profileKey };
  const put = await handleSyncRequest(rooms, new Request(`http://sync.local/v1/rooms/${code}/place`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(place),
  }));
  assert.equal(put.status, 200);
  const view = await handleSyncRequest(rooms, new Request(`http://sync.local/v1/rooms/${code}/family`, {
    method: 'GET',
    headers: {
      'x-umap-sync-key': token,
      'x-umap-profile-key': recovered.body.account.profileKey,
      'x-umap-member': recovered.body.account.memberId,
    },
  }));
  const family = await view.json();
  const same = family.places.filter((item) => item.memberId === 'local-restore1');
  assert.equal(same.length, 1);
});

test('restoring a snapshot reapplies the same person, room keys, and records', () => {
  const account = publicAccount({
    memberId: 'local-restore1',
    profileKey: 'profilekeyAAAAAAAA',
    profile: { name: '엄마', photo: null },
    room: { code: '48291', writeKey: 'writeKeyAAAAAAAAAA', readKey: 'readKeyAAAAAAAAAAA' },
    guardians: [{ id: 'g-1', label: '가족', code: '48291', share: 'allowed' }],
    home: null,
    journeys: [{ id: 'j-1', startedAt: 1, endedAt: 2, distanceM: 100, points: [], start: { lat: 1, lng: 1, label: '하계동' }, end: { lat: 2, lng: 2, label: '중계동' } }],
    visits: [{ id: 'v-1', lat: 37.6365, lng: 127.0680, arrivedAt: 1, leftAt: 2, label: '하계1차청구아파트 104동', source: 'geocode' }],
    recoveryCode: 'ABCDEFGHJKLN',
    googleSub: '1098234765',
  });
  const fresh = {
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
  const restored = applyAccountSnapshot(fresh, account);
  assert.equal(restored.profile.id, 'local-restore1');
  assert.equal(restored.inviteCode, '48291');
  assert.equal(restored.syncWriteKey, 'writeKeyAAAAAAAAAA');
  assert.equal(restored.journeys.self[0].id, 'j-1');
  assert.equal(restored.visits.self[0].label, '하계1차청구아파트 104동');
  assert.equal(restored.members.some((member) => member.id !== 'self' && member.publisherId === 'local-restore1'), false);
  const shot = snapshotFromSession(restored);
  assert.equal(shot.memberId, 'local-restore1');
  assert.equal(shot.room.code, '48291');
});

test('account routes stay out of family rooms when the path is wrong', async () => {
  const op = await parseAccountOperation(new Request('http://sync.local/v1/rooms/48291', { method: 'GET' }));
  assert.equal(op, null);
});

test('a stale backup after recover updates the same account and does not mint a second book', async () => {
  const accounts = createMemoryAccountStore();
  const created = await accountCall(accounts, 'POST', '/v1/account', { body: snapshot() });
  assert.equal(created.status, 200);
  const oldKey = created.body.account.accountKey;
  const recovery = created.body.account.recoveryCode;

  const recovered = await accountCall(accounts, 'POST', '/v1/account/recover', { body: { code: recovery } });
  assert.equal(recovered.status, 200);
  assert.notEqual(recovered.body.account.accountKey, oldKey);

  const stale = await accountCall(accounts, 'PUT', '/v1/account', {
    accountKey: oldKey,
    body: snapshot({
      journeys: [{
        id: 'j-2',
        startedAt: Date.now() - 2_000_000,
        endedAt: Date.now() - 1_800_000,
        distanceM: 400,
        points: [
          { lat: 37.6365, lng: 127.0680, at: Date.now() - 2_000_000 },
          { lat: 37.6368, lng: 127.0684, at: Date.now() - 1_800_000 },
        ],
        start: { lat: 37.6365, lng: 127.0680, label: '하계1차청구아파트 104동' },
        end: { lat: 37.6368, lng: 127.0684, label: '하계동' },
      }],
    }),
  });
  assert.equal(stale.status, 200);
  assert.equal(stale.body.account.memberId, 'local-restore1');
  assert.equal(stale.body.account.recoveryCode, recovery);
  assert.equal(stale.body.account.journeys[0].id, 'j-2');
  assert.notEqual(stale.body.account.accountKey, oldKey);

  const replay = await accountCall(accounts, 'POST', '/v1/account', { body: snapshot() });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.account.memberId, 'local-restore1');
  assert.equal(replay.body.account.recoveryCode, recovery);

  const other = await accountCall(accounts, 'POST', '/v1/account', {
    body: snapshot({ profileKey: 'otherkeyAAAAAAAAAA' }),
  });
  assert.equal(other.status, 409);
});

test('Kakao and Naver tokens restore the same book and can share one account', async () => {
  const accounts = createMemoryAccountStore();
  const extras = {
    fetchKakaoUser: async (token) => {
      if (token !== 'kakao-access-ok') return { ok: false, status: 401, kakaoCode: -401, kakaoMsg: 'invalid token' };
      return { id: 123456789, kakao_account: { profile: { nickname: '엄마' } } };
    },
    fetchNaverUser: async (token) => {
      if (token !== 'naver-access-ok') throw new Error('naver');
      return { resultcode: '00', response: { id: 'naver-user-88', nickname: '엄마' } };
    },
    exchangeNaverCode: async ({ code, state, redirectUri, clientId, clientSecret }) => {
      if (
        code !== 'naver-code-1'
        || state !== 'state-1'
        || redirectUri !== 'kinnex://naver'
        || clientId !== 'naverclientid1'
        || clientSecret !== 'naversecret1'
      ) {
        return null;
      }
      return { access_token: 'naver-access-ok' };
    },
    naverClientId: 'naverclientid1',
    naverClientSecret: 'naversecret1',
  };

  const kakao = await accountCall(accounts, 'POST', '/v1/account/kakao', {
    body: { accessToken: 'kakao-access-ok', snapshot: snapshot() },
    extras,
  });
  assert.equal(kakao.status, 200);
  assert.equal(kakao.body.account.memberId, 'local-restore1');
  assert.equal(kakao.body.account.kakaoLinked, true);
  assert.equal(kakao.body.account.googleLinked, false);

  const naver = await accountCall(accounts, 'POST', '/v1/account/naver', {
    accountKey: kakao.body.account.accountKey,
    body: { code: 'naver-code-1', state: 'state-1', redirectUri: 'kinnex://naver' },
    extras,
  });
  assert.equal(naver.status, 200);
  assert.equal(naver.body.account.memberId, 'local-restore1');
  assert.equal(naver.body.account.kakaoLinked, true);
  assert.equal(naver.body.account.naverLinked, true);

  const restored = await accountCall(accounts, 'POST', '/v1/account/naver', {
    body: { accessToken: 'naver-access-ok', snapshot: snapshot({ memberId: 'local-newphone2', profileKey: 'otherkeyAAAAAAAAAA' }) },
    extras,
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.restored, true);
  assert.equal(restored.body.account.memberId, 'local-restore1');

  const forged = await accountCall(accounts, 'POST', '/v1/account/kakao', {
    body: { accessToken: 'wrong-token' },
    extras,
  });
  assert.equal(forged.status, 401);

  const missingSecret = await accountCall(accounts, 'POST', '/v1/account/naver', {
    body: { code: 'naver-code-1', state: 'state-1', redirectUri: 'kinnex://naver' },
    extras: { ...extras, naverClientSecret: '' },
  });
  assert.equal(missingSecret.status, 503);
  assert.match(missingSecret.body.message, /NAVER_CLIENT_SECRET/);

  const missingRedirect = await accountCall(accounts, 'POST', '/v1/account/naver', {
    body: { code: 'naver-code-1', state: 'state-1' },
    extras,
  });
  assert.equal(missingRedirect.status, 401);

  const forgedRedirect = await accountCall(accounts, 'POST', '/v1/account/naver', {
    body: { code: 'naver-code-1', state: 'state-1', redirectUri: 'https://evil.example/callback' },
    extras,
  });
  assert.equal(forgedRedirect.status, 401);
});

test('linking someone else\'s Kakao does not rotate that session', async () => {
  const accounts = createMemoryAccountStore();
  const extras = {
    fetchKakaoUser: async () => ({ id: 123456789, kakao_account: { profile: { nickname: '엄마' } } }),
  };
  const owner = await accountCall(accounts, 'POST', '/v1/account/kakao', {
    body: { accessToken: 'kakao-access-ok', snapshot: snapshot() },
    extras,
  });
  assert.equal(owner.status, 200);
  const ownerId = await accounts.get('member:local-restore1');
  const before = await accounts.get(`acct:${ownerId}`);

  const other = await accountCall(accounts, 'POST', '/v1/account', {
    body: snapshot({
      memberId: 'local-otherphone',
      profileKey: 'otherkeyAAAAAAAAAA',
      profile: { name: '아빠', photo: null },
      room: { code: '10002', writeKey: 'writeKeyBBBBBBBBBB', readKey: 'readKeyBBBBBBBBBBB' },
    }),
  });
  assert.equal(other.status, 200);
  const conflict = await accountCall(accounts, 'POST', '/v1/account/kakao', {
    accountKey: other.body.account.accountKey,
    body: {
      accessToken: 'kakao-access-ok',
      mode: 'link',
      accountKey: other.body.account.accountKey,
    },
    extras,
  });
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.message, /다른 사람/);
  const after = await accounts.get(`acct:${ownerId}`);
  assert.equal(after.sessionHash, before.sessionHash);
  assert.equal(after.kakaoId, '123456789');

  const same = await accountCall(accounts, 'POST', '/v1/account/kakao', {
    accountKey: owner.body.account.accountKey,
    body: {
      accessToken: 'kakao-access-ok',
      mode: 'link',
      accountKey: owner.body.account.accountKey,
    },
    extras,
  });
  assert.equal(same.status, 200);
  assert.equal(same.body.account.memberId, 'local-restore1');
  assert.equal(same.body.account.accountKey, owner.body.account.accountKey);

  const missed = await accountCall(accounts, 'POST', '/v1/account/kakao', {
    accountKey: 'missingKeyAAAAAAAAA',
    body: {
      accessToken: 'kakao-access-ok',
      mode: 'link',
      accountKey: 'missingKeyAAAAAAAAA',
    },
    extras,
  });
  assert.equal(missed.status, 404);
  const still = await accounts.get(`acct:${ownerId}`);
  assert.equal(still.sessionHash, before.sessionHash);
});

test('link mode with a stale session keeps the same member when the snapshot matches', async () => {
  const accounts = createMemoryAccountStore();
  const extras = {
    fetchKakaoUser: async () => ({ id: 123456789, kakao_account: { profile: { nickname: '엄마' } } }),
    fetchNaverUser: async () => ({ resultcode: '00', response: { id: 'naver-user-88', nickname: '엄마' } }),
  };
  const created = await accountCall(accounts, 'POST', '/v1/account', { body: snapshot() });
  assert.equal(created.status, 200);
  const stale = 'staleKeyAAAAAAAAAAAA';
  const linked = await accountCall(accounts, 'POST', '/v1/account/kakao', {
    accountKey: stale,
    body: { accessToken: 'kakao-access-ok', mode: 'link', accountKey: stale, snapshot: snapshot() },
    extras,
  });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.account.memberId, 'local-restore1');
  assert.equal(linked.body.account.kakaoLinked, true);
  assert.equal(linked.body.account.nameChosen, true);
  assert.notEqual(linked.body.account.accountKey, stale);
  assert.notEqual(linked.body.account.accountKey, created.body.account.accountKey);
  const again = await accountCall(accounts, 'GET', '/v1/account', { accountKey: linked.body.account.accountKey });
  assert.equal(again.status, 200);
  assert.equal(again.body.account.journeys[0].id, 'j-1');

  const naver = await accountCall(accounts, 'POST', '/v1/account/naver', {
    accountKey: stale,
    body: { accessToken: 'naver-access-ok', mode: 'link', accountKey: stale, snapshot: snapshot() },
    extras,
  });
  assert.equal(naver.status, 200);
  assert.equal(naver.body.account.memberId, 'local-restore1');
  assert.equal(naver.body.account.naverLinked, true);
  assert.equal(naver.body.account.kakaoLinked, true);
  assert.notEqual(naver.body.account.accountKey, stale);
});

test('link mode without a snapshot does not mint an account', async () => {
  const accounts = createMemoryAccountStore();
  const extras = {
    fetchKakaoUser: async () => ({ id: 555666777, kakao_account: { profile: { nickname: '엄마' } } }),
  };
  const missing = await accountCall(accounts, 'POST', '/v1/account/kakao', {
    accountKey: 'staleKeyAAAAAAAAAAAA',
    body: { accessToken: 'kakao-access-ok', mode: 'link', accountKey: 'staleKeyAAAAAAAAAAAA' },
    extras,
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'link-session');
  assert.match(missing.body.message, /복구 코드로 먼저 들어온 뒤 연결해 주세요/);
  assert.equal(await accounts.get('kakao:555666777'), undefined);
  assert.equal(await accounts.get('member:local-restore1'), undefined);

  const rejected = await accountCall(accounts, 'POST', '/v1/account/kakao', {
    body: { accessToken: 'wrong-token', mode: 'link' },
    extras: { fetchKakaoUser: async () => null },
  });
  assert.equal(rejected.status, 401);
  assert.equal(rejected.body.error, 'token');
  assert.match(rejected.body.message, /토큰이 거절/);
  assert.doesNotMatch(rejected.body.message, /복구 코드/);

  const created = await accountCall(accounts, 'POST', '/v1/account/kakao', {
    body: { accessToken: 'kakao-access-ok', mode: 'link', snapshot: snapshot() },
    extras,
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.account.created, true);
  assert.equal(created.body.account.kakaoLinked, true);
  assert.equal(created.body.account.memberId, 'local-restore1');
  assert.equal(accountNeedsDisplayName(created.body.account), true);
});

test('logout wipes the stored account key so the next sign-in does not reuse the previous person', () => {
  const storage = new Map();
  const fake = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, value); },
    removeItem: (key) => { storage.delete(key); },
  };
  writeStoredAccountKey(fake, 'accountKeyAAAAAAAAAA');
  writeStoredRecoveryCode(fake, 'ABCDEFGHJKLN');
  rememberAccountSecrets(fake, {
    accountKey: 'accountKeyAAAAAAAAAA',
    recoveryCode: 'ABCDEFGHJKLN',
    kakaoLinked: true,
    naverLinked: true,
  });
  assert.deepEqual(readStoredAccountLinks(fake), { kakao: true, naver: true });
  rememberAccountSecrets(fake, {
    accountKey: 'accountKeyBBBBBBBBBB',
    recoveryCode: 'ABCDEFGHJKLN',
    kakaoLinked: false,
    naverLinked: false,
  });
  assert.deepEqual(readStoredAccountLinks(fake), { kakao: false, naver: false });
  fake.setItem(LEFTOVER_GOOGLE_ACCOUNT_KEY, JSON.stringify({ sub: '1098234765', localId: 'local-restore1' }));
  const epoch = currentAccountBackupEpoch();
  logoutLocalAccount(fake);
  assert.equal(fake.getItem(ACCOUNT_KEY_STORAGE), null);
  assert.equal(fake.getItem(RECOVERY_CODE_STORAGE), null);
  assert.equal(fake.getItem(ACCOUNT_LINKS_STORAGE), null);
  assert.equal(fake.getItem(LEFTOVER_GOOGLE_ACCOUNT_KEY), null);
  assert.equal(persistAccountSecretsIfCurrent(fake, {
    memberId: 'local-restore1',
    profileKey: 'profilekeyAAAAAAAA',
    profile: { name: '엄마' },
    room: { code: '48291', writeKey: 'writeKeyAAAAAAAAAA', readKey: 'readKeyAAAAAAAAAAA' },
    accountKey: 'accountKeyAAAAAAAAAA',
    recoveryCode: 'ABCDEFGHJKLN',
  }, epoch), false);
  assert.equal(fake.getItem(ACCOUNT_KEY_STORAGE), null);
  assert.equal(fake.getItem(RECOVERY_CODE_STORAGE), null);
  assert.notEqual(currentAccountBackupEpoch(), epoch);
});

test('a new provider account asks for a name and a restored one does not', () => {
  assert.equal(accountNeedsDisplayName({ created: true, nameChosen: true, profile: { name: '엄마' } }), true);
  assert.equal(accountNeedsDisplayName({ nameChosen: false, profile: { name: '가족' } }), true);
  assert.equal(accountNeedsDisplayName({ nameChosen: true, profile: { name: '엄마' }, journeys: [{ id: 'j-1' }] }), false);
  assert.equal(accountNeedsDisplayName({ profile: { name: '' } }), true);
});

test('delete account removes the book, journeys, provider indexes, and room membership', async () => {
  const accounts = createMemoryAccountStore();
  const rooms = createMemoryStore();
  const deletedTokens = [];
  const originalDelete = rooms.delete.bind(rooms);
  rooms.delete = async (token) => {
    deletedTokens.push(token);
    await originalDelete(token);
  };
  const created = await accountCall(accounts, 'POST', '/v1/account', { body: snapshot(), rooms });
  assert.equal(created.status, 200);
  const key = created.body.account.accountKey;
  const code = created.body.account.recoveryCode;
  const recordId = await accounts.get('member:local-restore1');
  const record = await accounts.get(`acct:${recordId}`);
  record.googleSub = '1098234765';
  record.kakaoId = '123456789';
  record.naverId = 'naver-user-88';
  const guestSync = await syncTokenFor('writeKeyBBBBBBBBBB', 'readKeyBBBBBBBBBBB');
  record.guardians = [{ id: 'g-10002', label: '아빠', code: '10002', share: 'accepted', syncToken: guestSync }];
  await accounts.put(`acct:${recordId}`, record);
  await accounts.put('google:1098234765', recordId);
  await accounts.put('kakao:123456789', recordId);
  await accounts.put('naver:naver-user-88', recordId);

  const ownToken = await memberRoomToken({
    code: '48291',
    writeKey: 'writeKeyAAAAAAAAAA',
    readKey: 'readKeyAAAAAAAAAAA',
  });
  const guestToken = await memberRoomToken({ code: '10002', syncToken: guestSync, memberId: 'local-restore1' });
  await rooms.write(ownToken, {
    ...emptyRoom(),
    profiles: { 'local-restore1': { memberId: 'local-restore1', name: '엄마', at: 1 } },
    trails: { 'local-restore1': { memberId: 'local-restore1', journeys: [{ id: 'j-1' }] } },
    places: {
      self: { memberId: 'local-restore1', name: '엄마', sharing: true, audience: 'family', lat: 37.5, lng: 127, at: 1 },
      legacy: { name: '옛이름', sharing: false, audience: 'family', lat: 37.5, lng: 127, at: 1 },
    },
    threads: { pair: [{ id: 'chat1', from: '엄마', to: '아빠', text: '안녕', at: 1 }] },
  });
  await rooms.write(guestToken, {
    ...emptyRoom(),
    places: {
      self: { memberId: 'local-restore1', name: '엄마', sharing: true, audience: 'family', lat: 37.5, lng: 127, at: 1 },
      other: { memberId: 'local-otherphone', name: '아빠', sharing: true, audience: 'family', lat: 37.6, lng: 127.1, at: 2 },
    },
    profiles: {
      'local-restore1': { memberId: 'local-restore1', name: '엄마', at: 1 },
      'local-otherphone': { memberId: 'local-otherphone', name: '아빠', at: 2 },
    },
  });

  let kakaoUnlinked = '';
  let naverRevoked = '';
  const removed = await accountCall(accounts, 'DELETE', '/v1/account', {
    accountKey: key,
    rooms,
    extras: {
      unlinkKakao: async (id) => {
        kakaoUnlinked = id;
        throw new Error('kakao down');
      },
      revokeNaver: async (id) => {
        naverRevoked = id;
      },
    },
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.ok, true);
  assert.equal(kakaoUnlinked, '123456789');
  assert.equal(naverRevoked, 'naver-user-88');
  assert.equal(await accounts.get(`acct:${recordId}`), undefined);
  assert.equal(await accounts.get('member:local-restore1'), undefined);
  assert.equal(await accounts.get(`session:${record.sessionHash}`), undefined);
  assert.equal(await accounts.get(`recovery:${record.recoveryHash}`), undefined);
  assert.equal(await accounts.get('google:1098234765'), undefined);
  assert.equal(await accounts.get('kakao:123456789'), undefined);
  assert.equal(await accounts.get('naver:naver-user-88'), undefined);
  assert.equal(deletedTokens.includes(ownToken), true);
  const guest = await rooms.read(guestToken);
  assert.equal(guest.profiles['local-otherphone'].name, '아빠');
  assert.equal(guest.profiles['local-restore1'], undefined);
  assert.equal(guest.places.self, undefined);
  assert.equal(deletedTokens.includes(guestToken), false);

  const recover = await accountCall(accounts, 'POST', '/v1/account/recover', { body: { code }, rooms });
  assert.equal(recover.status, 403);
  const denied = await accountCall(accounts, 'DELETE', '/v1/account', { accountKey: 'missingKeyAAAAAAAAA', rooms });
  assert.equal(denied.status, 404);
  assert.match(denied.body.message, /저장된 계정/);
});

test('withdrawal clears this device storage', () => {
  const map = new Map();
  const storage = {
    get length() { return map.size; },
    key(index) { return [...map.keys()][index] ?? null; },
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
  storage.setItem('umap_account_key_v1', 'accountKeyAAAAAAAAAA');
  storage.setItem('umap_family_v1', '{}');
  storage.setItem('umap_dm_v1:1:a', '[]');
  storage.setItem('other-app', 'keep');
  clearDeviceAccount(storage, storage);
  assert.equal(storage.getItem('umap_account_key_v1'), null);
  assert.equal(storage.getItem('umap_family_v1'), null);
  assert.equal(storage.getItem('umap_dm_v1:1:a'), null);
  assert.equal(storage.getItem('other-app'), 'keep');
  assert.deepEqual(interpretAccountDelete(200, { ok: true }), { ok: true });
  assert.equal(interpretAccountDelete(404, { error: 'account' }).ok, false);
  assert.match(interpretAccountDelete(404, { message: '저장된 계정을 찾지 못했습니다.' }).message, /다시 들어온 뒤 탈퇴/);
});

test('naver callback redirects code and state and rejects bad params', async () => {
  const rooms = createMemoryStore();
  const accounts = createMemoryAccountStore();
  const ok = await handleSyncRequest(rooms, new Request('http://sync.local/v1/naver/callback?code=naver-code-1&state=state-1'), { accounts });
  assert.equal(ok.status, 302);
  const location = new URL(ok.headers.get('location'));
  assert.equal(location.protocol, 'kinnex:');
  assert.equal(location.host, 'naver');
  assert.equal(location.searchParams.get('code'), 'naver-code-1');
  assert.equal(location.searchParams.get('state'), 'state-1');

  const missing = await handleSyncRequest(rooms, new Request('http://sync.local/v1/naver/callback?state=state-1'), { accounts });
  assert.equal(missing.status, 400);
  const oversized = await handleSyncRequest(rooms, new Request(`http://sync.local/v1/naver/callback?code=${'a'.repeat(300)}&state=state-1`), { accounts });
  assert.equal(oversized.status, 400);
  const errored = await handleSyncRequest(rooms, new Request('http://sync.local/v1/naver/callback?error=access_denied&state=state-1'), { accounts });
  assert.equal(errored.status, 302);
  assert.equal(new URL(errored.headers.get('location')).searchParams.get('error'), 'access_denied');
});

test('naver code exchange sends the registered callback as redirect_uri', async () => {
  const accounts = createMemoryAccountStore();
  let seen = '';
  const extras = {
    exchangeNaverCode: async ({ redirectUri, code, state }) => {
      seen = redirectUri;
      assert.equal(code, 'naver-code-1');
      assert.equal(state, 'state-1');
      return { access_token: 'naver-access-ok' };
    },
    fetchNaverUser: async () => ({ resultcode: '00', response: { id: 'navercallback88', nickname: '엄마' } }),
    naverClientId: 'naverclientid1',
    naverClientSecret: 'naversecret1',
  };
  const created = await accountCall(accounts, 'POST', '/v1/account/naver', {
    body: { code: 'naver-code-1', state: 'state-1', redirectUri: NAVER_APP_REDIRECT, snapshot: snapshot() },
    extras,
  });
  assert.equal(seen, NAVER_APP_REDIRECT);
  assert.equal(created.status, 200);
  assert.equal(created.body.account.naverLinked, true);
  const lookalike = await accountCall(accounts, 'POST', '/v1/account/naver', {
    body: { code: 'naver-code-1', state: 'state-1', redirectUri: `${NAVER_APP_REDIRECT}/extra` },
    extras,
  });
  assert.equal(lookalike.status, 401);
});

test('naver token HTTP 200 without access_token reports the error and never logs secrets', async () => {
  const code = 'NaverAuthCodeValue123456789';
  const state = 'NaverStateValue1234567890ab';
  const secret = 'NaverClientSecretValue123456';
  const logs = [];
  const originalError = console.error;
  const originalFetch = globalThis.fetch;
  console.error = (...args) => {
    logs.push(args.map((item) => String(item)).join(' '));
  };
  const accounts = createMemoryAccountStore();
  let sent = '';
  globalThis.fetch = async (url, init) => {
    sent = String(init && init.body);
    assert.equal(String(url), 'https://nid.naver.com/oauth2.0/token');
    return new Response(JSON.stringify({
      error: 'invalid_request',
      error_description: `bad ${code} ${state} ${secret}`,
    }), { status: 200 });
  };
  try {
    const rejected = await accountCall(accounts, 'POST', '/v1/account/naver', {
      body: { code, state, redirectUri: NAVER_APP_REDIRECT, snapshot: snapshot() },
      extras: { naverClientId: 'naverclientid1', naverClientSecret: secret },
    });
    assert.equal(rejected.status, 401);
    assert.equal(rejected.body.error, 'token');
    assert.equal(rejected.body.reason, 'naver_token_invalid_request');
    assert.match(rejected.body.message, /토큰이 거절/);
    const form = new URLSearchParams(sent);
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(form.get('client_id'), 'naverclientid1');
    assert.equal(form.get('client_secret'), secret);
    assert.equal(form.get('code'), code);
    assert.equal(form.get('state'), state);
    assert.equal(form.get('redirect_uri'), NAVER_APP_REDIRECT);
    const log = logs.join('\n');
    assert.match(log, /naver token failed/);
    assert.match(log, /"status":200/);
    assert.match(log, /invalid_request/);
    assert.match(log, /"keys":\["error","error_description"\]/);
    assert.match(log, /"redirectSent":true/);
    assert.equal(log.includes(code), false);
    assert.equal(log.includes(state), false);
    assert.equal(log.includes(secret), false);
  } finally {
    console.error = originalError;
    globalThis.fetch = originalFetch;
  }
});

test('naver profile failure is naver_me and code is not double-encoded', async () => {
  const code = 'a+b/c=';
  const state = 's t';
  const token = 'NaverAccessTokenValue1234567';
  const logs = [];
  const originalError = console.error;
  const originalFetch = globalThis.fetch;
  console.error = (...args) => {
    logs.push(args.map((item) => String(item)).join(' '));
  };
  const accounts = createMemoryAccountStore();
  let sent = '';
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('/oauth2.0/token')) {
      sent = String(init && init.body);
      return new Response(JSON.stringify({ access_token: token, token_type: 'bearer' }), { status: 200 });
    }
    return new Response(JSON.stringify({
      resultcode: '024',
      message: `profile ${token}`,
    }), { status: 200 });
  };
  try {
    const rejected = await accountCall(accounts, 'POST', '/v1/account/naver', {
      body: { code, state, redirectUri: NAVER_APP_REDIRECT },
      extras: { naverClientId: 'naverclientid1', naverClientSecret: 'naversecret1' },
    });
    assert.equal(rejected.status, 401);
    assert.equal(rejected.body.reason, 'naver_me');
    const form = new URLSearchParams(sent);
    assert.equal(form.get('code'), code);
    assert.equal(form.get('state'), state);
    assert.equal(sent.includes('%252B'), false);
    assert.equal(sent.includes('%253D'), false);
    const log = logs.join('\n');
    assert.match(log, /naver me failed/);
    assert.match(log, /"resultcode":"024"/);
    assert.match(log, /profile \[redacted\]/);
    assert.equal(log.includes(token), false);
    assert.equal(log.includes('/nid/me'), false);
  } finally {
    console.error = originalError;
    globalThis.fetch = originalFetch;
  }
});

test('kakao verification reports the upstream code and never logs the token', async () => {
  const token = 'KakaoSecretTokenValue123456';
  const logs = [];
  const originalError = console.error;
  const originalFetch = globalThis.fetch;
  console.error = (...args) => {
    logs.push(args.map((item) => String(item)).join(' '));
  };
  const accounts = createMemoryAccountStore();
  async function withFetch(fetchImpl, body = { accessToken: token }) {
    logs.length = 0;
    globalThis.fetch = fetchImpl;
    return accountCall(accounts, 'POST', '/v1/account/kakao', { body });
  }
  try {
    const rejected = await withFetch(async () => new Response(JSON.stringify({
      code: -401,
      msg: 'this access token does not exist',
    }), { status: 401 }));
    assert.equal(rejected.status, 401);
    assert.equal(rejected.body.error, 'token');
    assert.equal(rejected.body.reason, 'kakao_-401');
    assert.match(logs.join('\n'), /kakao verify failed/);
    assert.equal(logs.join('\n').includes(token), false);

    const ip = await withFetch(async () => new Response(JSON.stringify({
      code: -401,
      msg: 'ip mismatched callerIp=203.0.113.8',
    }), { status: 401 }));
    assert.equal(ip.status, 401);
    assert.equal(ip.body.reason, 'kakao_ip');
    assert.match(logs.join('\n'), /\[ip\]/);
    assert.equal(logs.join('\n').includes('203.0.113.8'), false);
    assert.equal(logs.join('\n').includes(token), false);

    const thrown = await withFetch(async () => {
      throw new Error(`network ${token}`);
    });
    assert.equal(thrown.status, 502);
    assert.equal(thrown.body.error, 'upstream');
    assert.equal(logs.join('\n').includes(token), false);

    const upstream = await withFetch(async () => new Response('unavailable', { status: 503 }));
    assert.equal(upstream.status, 502);
    assert.equal(upstream.body.error, 'upstream');

    const ok = await withFetch(async (url) => {
      if (String(url).includes('access_token_info')) return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ id: 123456789, kakao_account: { profile: { nickname: '엄마' } } }), { status: 200 });
    }, { accessToken: token, snapshot: snapshot({ memberId: 'local-kakao200', profileKey: 'profilekeyBBBBBBBB' }) });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.account.kakaoLinked, true);
    assert.equal(logs.join('\n').includes(token), false);
  } finally {
    console.error = originalError;
    globalThis.fetch = originalFetch;
  }
});

test('an empty keepHistory backup does not erase stored journeys', async () => {
  const accounts = createMemoryAccountStore();
  const created = await accountCall(accounts, 'POST', '/v1/account', { body: snapshot() });
  assert.equal(created.status, 200);
  const kept = await accountCall(accounts, 'PUT', '/v1/account', {
    accountKey: created.body.account.accountKey,
    body: { ...snapshot({ journeys: [], visits: [], home: null }), keepHistory: true },
  });
  assert.equal(kept.status, 200);
  assert.equal(kept.body.account.journeys[0].start.label, '하계1차청구아파트 104동');
  const home = await accountCall(accounts, 'PUT', '/v1/account', {
    accountKey: created.body.account.accountKey,
    body: {
      ...snapshot({ journeys: [], visits: [] }),
      keepHistory: true,
      home: { label: '우리 집', lat: 37.6365, lng: 127.068, radiusM: 150 },
    },
  });
  assert.equal(home.status, 200);
  assert.equal(home.body.account.journeys[0].start.label, '하계1차청구아파트 104동');
  assert.equal(home.body.account.home.label, '우리 집');
  const cleared = await accountCall(accounts, 'PUT', '/v1/account', {
    accountKey: created.body.account.accountKey,
    body: { ...snapshot({ journeys: [], visits: [], home: null }), keepHistory: true },
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.account.home, null);
  assert.equal(cleared.body.account.clearHome, true);
  assert.equal(cleared.body.account.journeys[0].start.label, '하계1차청구아파트 104동');
});

test('a sealed backup deletes plaintext history and the stored recovery code', async () => {
  const { base64UrlToBytes, mintDeviceKey, sealJson, wrapVault } = await import('../src/lib/familySeal.mjs');
  const accounts = createMemoryAccountStore();
  const created = await accountCall(accounts, 'POST', '/v1/account', { body: snapshot() });
  assert.equal(created.status, 200);
  assert.equal(created.body.account.journeys[0].start.label, '하계1차청구아파트 104동');
  const code = normalizeRecoveryCode(created.body.account.recoveryCode);
  const device = await mintDeviceKey();
  const content = base64UrlToBytes(device.contentKey);
  const sealedHistory = await sealJson(content, device.publicKey, {
    journeys: snapshot().journeys,
    visits: snapshot().visits,
    home: { label: '하계1차청구아파트', lat: 37.6365, lng: 127.068, radiusM: 200 },
  });
  const vault = await wrapVault(code, device);
  const saved = await accountCall(accounts, 'PUT', '/v1/account', {
    accountKey: created.body.account.accountKey,
    body: {
      ...snapshot({ journeys: [], visits: [], home: null }),
      vault,
      sealedHistory,
      dropRecovery: true,
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.account.recoveryCode, '');
  assert.equal(saved.body.account.journeys.length, 0);
  assert.equal(saved.body.account.visits.length, 0);
  assert.equal(saved.body.account.home, null);
  assert.equal(JSON.stringify(saved.body.account.journeys).includes('하계1차청구아파트'), false);
  assert.equal(typeof saved.body.account.sealedHistory.ct, 'string');
  const again = await accountCall(accounts, 'POST', '/v1/account/recover', { body: { code } });
  assert.equal(again.status, 200);
  assert.equal(again.body.account.recoveryCode, '');
  assert.equal(again.body.account.journeys.length, 0);
  assert.ok(again.body.account.vault);
});
