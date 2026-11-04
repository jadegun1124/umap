// Apply a Worker account snapshot onto this phone. The member id stays the
// same so the family room does not mint a second card.

import { formatRecoveryCode, normalizeRecoveryCode } from '../../sync/account.mjs';

export {
  ACCOUNT_LINK_CONFLICT_MESSAGE,
  ACCOUNT_LINK_SESSION_MESSAGE,
  ACCOUNT_UNLINKED_MESSAGE,
  ACCOUNT_VERIFY_MESSAGE,
} from '../../sync/account.mjs';

export const ACCOUNT_KEY_STORAGE = 'umap_account_key_v1';
export const RECOVERY_CODE_STORAGE = 'umap_recovery_code_v1';
export const ACCOUNT_LINKS_STORAGE = 'umap_account_links_v1';
export const MERGED_FROM_STORAGE = 'umap_merged_from_v1';
const LEFTOVER_GOOGLE_ACCOUNT_KEY = 'umap_google_account_v1';

const MEMBER_ID = /^local-[a-z0-9]{3,64}$/;
const KEY_PART = /^[A-Za-z0-9_-]{16,64}$/;

export function readStoredAccountKey(storage) {
  if (!storage) return '';
  const value = storage.getItem(ACCOUNT_KEY_STORAGE);
  return typeof value === 'string' && KEY_PART.test(value) ? value : '';
}

export function writeStoredAccountKey(storage, key) {
  if (!storage || !key || !KEY_PART.test(key)) return;
  storage.setItem(ACCOUNT_KEY_STORAGE, key);
}

export function readStoredRecoveryCode(storage) {
  if (!storage) return '';
  return formatRecoveryCode(storage.getItem(RECOVERY_CODE_STORAGE) || '');
}

export function writeStoredRecoveryCode(storage, code) {
  if (!storage) return;
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) return;
  storage.setItem(RECOVERY_CODE_STORAGE, normalized);
}

export function readStoredAccountLinks(storage) {
  const empty = { kakao: false, naver: false };
  if (!storage) return empty;
  try {
    const parsed = JSON.parse(storage.getItem(ACCOUNT_LINKS_STORAGE) || '');
    return {
      kakao: parsed?.kakao === true,
      naver: parsed?.naver === true,
    };
  } catch {
    return empty;
  }
}

function writeStoredAccountLinks(storage, links) {
  if (!storage) return;
  storage.setItem(ACCOUNT_LINKS_STORAGE, JSON.stringify({
    kakao: links.kakao === true,
    naver: links.naver === true,
  }));
}

export function readMergedFromMember(storage) {
  if (!storage) return '';
  const value = storage.getItem(MERGED_FROM_STORAGE);
  return typeof value === 'string' && MEMBER_ID.test(value) ? value : '';
}

export function clearStoredAccount(storage) {
  if (!storage) return;
  storage.removeItem(ACCOUNT_KEY_STORAGE);
  storage.removeItem(RECOVERY_CODE_STORAGE);
  storage.removeItem(ACCOUNT_LINKS_STORAGE);
  storage.removeItem(MERGED_FROM_STORAGE);
}

let accountBackupEpoch = 0;

export function currentAccountBackupEpoch() {
  return accountBackupEpoch;
}

export function invalidateAccountBackup() {
  accountBackupEpoch += 1;
  return accountBackupEpoch;
}

export function persistAccountSecretsIfCurrent(storage, account, epoch) {
  if (epoch !== accountBackupEpoch) return false;
  rememberAccountSecrets(storage, account);
  return true;
}

export function logoutLocalAccount(storage) {
  invalidateAccountBackup();
  clearStoredAccount(storage);
  if (storage) {
    storage.removeItem(LEFTOVER_GOOGLE_ACCOUNT_KEY);
    storage.removeItem('umap_seal_device_v1');
    storage.removeItem('umap_family_keys_v1');
  }
}

function storageKeys(storage) {
  if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') return [];
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  return keys;
}

export function clearDeviceAccount(localStorage, sessionStorage) {
  invalidateAccountBackup();
  for (const storage of [localStorage, sessionStorage]) {
    if (!storage) continue;
    for (const key of storageKeys(storage)) {
      if (key.startsWith('umap_')) storage.removeItem(key);
    }
  }
}

export function interpretAccountDelete(status, body) {
  if (status === 200 && body && body.ok === true) return { ok: true };
  if (status === 404) {
    return {
      ok: false,
      message: '이 폰의 계정 세션을 찾지 못했습니다. 카카오·네이버 또는 복구 코드로 다시 들어온 뒤 탈퇴해 주세요.',
    };
  }
  const message = body && typeof body.message === 'string' && body.message
    ? body.message
    : '계정을 지우지 못했습니다. 다시 시도해 주세요.';
  return { ok: false, message };
}

export function accountNeedsDisplayName(account) {
  if (!account || typeof account !== 'object') return false;
  if (account.created === true) return true;
  const name = account.profile && typeof account.profile.name === 'string' ? account.profile.name.trim() : '';
  if (!name || name === '가족') return true;
  if (account.restored === true) return false;
  if (account.nameChosen === false) return true;
  return false;
}

export function rememberAccountSecrets(storage, account) {
  if (!account) return;
  if (account.accountKey) writeStoredAccountKey(storage, account.accountKey);
  if (account.recoveryCode) writeStoredRecoveryCode(storage, account.recoveryCode);
  if (typeof account.kakaoLinked === 'boolean' || typeof account.naverLinked === 'boolean') {
    const current = readStoredAccountLinks(storage);
    writeStoredAccountLinks(storage, {
      kakao: typeof account.kakaoLinked === 'boolean' ? account.kakaoLinked : current.kakao,
      naver: typeof account.naverLinked === 'boolean' ? account.naverLinked : current.naver,
    });
  }
  if (storage && typeof account.mergedFrom === 'string') {
    if (MEMBER_ID.test(account.mergedFrom)) storage.setItem(MERGED_FROM_STORAGE, account.mergedFrom);
    else storage.removeItem(MERGED_FROM_STORAGE);
  }
}

export const ACCOUNT_LINKED_OTHER_MESSAGE = '이 로그인은 다른 사람에 이미 연결되어 있습니다. 이 폰의 지도를 바꾸지 않았습니다.';

export function linkedAccountWouldSwitch(currentMemberId, account) {
  const current = typeof currentMemberId === 'string' ? currentMemberId : '';
  const next = account && typeof account.memberId === 'string' ? account.memberId : '';
  return Boolean(current && next && current !== next);
}

function selfJourneys(journeys, memberId) {
  if (!journeys || typeof journeys !== 'object') return [];
  if (Array.isArray(journeys.self) && journeys.self.length) return journeys.self;
  if (memberId && Array.isArray(journeys[memberId])) return journeys[memberId];
  return [];
}

function selfVisits(visits, memberId) {
  if (!visits || typeof visits !== 'object') return [];
  if (Array.isArray(visits.self) && visits.self.length) return visits.self;
  if (memberId && Array.isArray(visits[memberId])) return visits[memberId];
  return [];
}

export function snapshotFromSession(state) {
  const profile = state && state.profile;
  if (!profile || !MEMBER_ID.test(profile.id) || !KEY_PART.test(profile.profileKey || '')) return null;
  if (!state.inviteCode || !KEY_PART.test(state.syncWriteKey || '') || !KEY_PART.test(state.syncReadKey || '')) return null;
  return {
    memberId: profile.id,
    profileKey: profile.profileKey,
    profile: { name: profile.name, photo: profile.photo || null },
    room: {
      code: state.inviteCode,
      writeKey: state.syncWriteKey,
      readKey: state.syncReadKey,
    },
    guardians: Array.isArray(state.guardians) ? state.guardians : [],
    roster: rosterFromMembers(state.members),
    home: state.home || null,
    ...(state.homeCleared ? { homeCleared: true } : {}),
    journeys: selfJourneys(state.journeys, profile.id),
    visits: selfVisits(state.visits, profile.id),
  };
}

function rosterFromMembers(members) {
  const roster = [];
  for (const member of Array.isArray(members) ? members : []) {
    if (!member || member.id === 'self' || member.role === 'self') continue;
    const name = typeof member.name === 'string' ? member.name.trim().slice(0, 20) : '';
    const id = typeof member.id === 'string' ? member.id.trim().slice(0, 80) : '';
    if (!name || !id) continue;
    const row = { id, name };
    if (typeof member.role === 'string' && member.role) row.role = member.role.slice(0, 20);
    if (typeof member.publisherId === 'string' && member.publisherId) row.publisherId = member.publisherId.slice(0, 80);
    if (typeof member.inviteCode === 'string' && member.inviteCode) row.inviteCode = member.inviteCode.slice(0, 6);
    roster.push(row);
    if (roster.length >= 12) break;
  }
  return roster;
}

function restoredMember(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role || 'admin-share',
    lat: null,
    lng: null,
    accuracyM: 0,
    battery: null,
    charging: null,
    updatedAt: 0,
    moving: null,
    share: 'allowed',
    ...(row.publisherId ? { publisherId: row.publisherId } : {}),
    ...(row.inviteCode ? { inviteCode: row.inviteCode } : {}),
  };
}

function selfMember(profile) {
  return {
    id: 'self',
    name: profile.name,
    role: 'self',
    lat: null,
    lng: null,
    accuracyM: 0,
    battery: null,
    charging: null,
    updatedAt: Date.now(),
    moving: null,
    share: 'allowed',
    ...(profile.photo ? { photo: profile.photo } : {}),
  };
}

export function applyAccountSnapshot(state, account) {
  if (!account || !MEMBER_ID.test(account.memberId || '') || !account.room) return state;
  if (!KEY_PART.test(account.profileKey || '') || !KEY_PART.test(account.room.writeKey || '') || !KEY_PART.test(account.room.readKey || '')) {
    return state;
  }
  const name = typeof account.profile?.name === 'string' ? account.profile.name.trim().slice(0, 20) : '';
  if (!name) return state;
  const photo = typeof account.profile?.photo === 'string' && account.profile.photo.startsWith('data:image/')
    ? account.profile.photo
    : undefined;
  const profile = {
    id: account.memberId,
    name,
    profileKey: account.profileKey,
    ...(photo ? { photo } : {}),
  };
  const journeys = Array.isArray(account.journeys) ? account.journeys : [];
  const visits = Array.isArray(account.visits) ? account.visits : [];
  const roster = Array.isArray(account.roster) ? account.roster : [];
  const mergedFrom = typeof account.mergedFrom === 'string' && MEMBER_ID.test(account.mergedFrom) ? account.mergedFrom : '';
  const others = roster
    .filter((row) => row && row.id && row.id !== 'self' && row.name)
    .filter((row) => !mergedFrom || (row.id !== mergedFrom && row.publisherId !== mergedFrom))
    .map((row) => restoredMember(row));
  const nextStage = account.created === true
    ? (state.permissions?.completed ? 'map' : 'survey')
    : 'map';
  return {
    ...state,
    profile,
    members: [selfMember(profile), ...others],
    inviteCode: account.room.code,
    syncWriteKey: account.room.writeKey,
    syncReadKey: account.room.readKey,
    guardians: Array.isArray(account.guardians) ? account.guardians : [],
    home: account.home || null,
    journeys: journeys.length ? { self: journeys } : {},
    visits: visits.length ? { self: visits } : {},
    tracks: {},
    trailRevisions: {},
    pendingInvite: null,
    pendingLeaveAlert: null,
    pendingSyncToken: null,
    shareSelfWithFamily: state.permissions?.completed === true,
    historyLocked: account.historyLocked === false
      ? false
      : account.historyLocked === true || (!!mergedFrom && !!account.sealedHistory),
    hiddenMemberIds: mergedFrom ? [mergedFrom] : [],
    sealedHistory: account.sealedHistory || null,
    accountVault: account.vault || null,
    mergedVault: account.mergedVault || null,
    mode: null,
    stage: nextStage,
    tab: 'map',
  };
}

export function restoredProfile(account) {
  if (!account || !MEMBER_ID.test(account.memberId || '')) return null;
  const name = typeof account.profile?.name === 'string' ? account.profile.name.trim().slice(0, 20) : '';
  if (!name) return null;
  return {
    id: account.memberId,
    name,
    profileKey: account.profileKey,
    ...(account.profile?.photo ? { photo: account.profile.photo } : {}),
  };
}
