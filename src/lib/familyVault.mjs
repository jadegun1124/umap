// This phone's X25519 device key and the family keys it has unwrapped.
// The recovery code is the only copy that can rebuild the device key after a
// reinstall. Kakao and Naver restore the account, not this key.

import { normalizeRecoveryCode } from '../../sync/account.mjs';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  mintDeviceKey,
  openJson,
  sealJson,
  unwrapFamilyKey,
  unwrapVault,
  wrapFamilyKey,
  wrapVault,
} from './familySeal.mjs';

export const HISTORY_SHARE_KID = 'umap-history-key1';
const HISTORY_SHARE_STORAGE = 'umap_history_share_v1';

export const DEVICE_STORAGE = 'umap_seal_device_v1';
export const FAMILY_KEY_STORAGE = 'umap_family_keys_v1';

function readJson(storage, key) {
  if (!storage) return null;
  try {
    return JSON.parse(storage.getItem(key) || '');
  } catch {
    return null;
  }
}

export function readDevice(storage) {
  const parsed = readJson(storage, DEVICE_STORAGE);
  if (!parsed || typeof parsed.publicKey !== 'string' || typeof parsed.privateKey !== 'string' || typeof parsed.contentKey !== 'string') return null;
  return parsed;
}

export function writeDevice(storage, device) {
  if (!storage || !device) return;
  storage.setItem(DEVICE_STORAGE, JSON.stringify({
    publicKey: device.publicKey,
    privateKey: device.privateKey,
    contentKey: device.contentKey,
  }));
}

export async function ensureDevice(storage) {
  const current = readDevice(storage);
  if (current) return current;
  const created = await mintDeviceKey();
  writeDevice(storage, created);
  return created;
}

export function familyKeyRecord(storage, code) {
  const all = readJson(storage, FAMILY_KEY_STORAGE);
  const item = all && code ? all[code] : null;
  if (!item || typeof item.kid !== 'string' || typeof item.key !== 'string') return null;
  const key = base64UrlToBytes(item.key);
  if (!key || key.length !== 32) return null;
  return { kid: item.kid, key };
}

export function rememberFamilyKey(storage, code, kid, key) {
  if (!storage || !code || !kid || !(key instanceof Uint8Array)) return;
  const all = readJson(storage, FAMILY_KEY_STORAGE) || {};
  const encoded = bytesToBase64Url(key);
  const current = all[code];
  if (current && current.kid === kid && current.key === encoded) return;
  all[code] = { kid, key: encoded };
  storage.setItem(FAMILY_KEY_STORAGE, JSON.stringify(all));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('umap-family-keys'));
}

export function contentKeyBytes(device) {
  const key = device ? base64UrlToBytes(device.contentKey) : null;
  return key && key.length === 32 ? key : null;
}

export function snapshotHistoryEmpty(snapshot) {
  const journeys = Array.isArray(snapshot && snapshot.journeys) ? snapshot.journeys : [];
  const visits = Array.isArray(snapshot && snapshot.visits) ? snapshot.visits : [];
  return journeys.length === 0 && visits.length === 0;
}

function keepStoredHistory(snapshot) {
  const kept = { ...snapshot, keepHistory: true };
  delete kept.journeys;
  delete kept.visits;
  delete kept.home;
  delete kept.sealedHistory;
  return kept;
}

export async function prepareBackup(snapshot, storage, recoveryCode) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  // An update can open an empty session before the device seal. Sealing that
  // empty list replaces the server's sealedHistory. Keep what is already there.
  if (snapshotHistoryEmpty(snapshot)) {
    const kept = keepStoredHistory(snapshot);
    if (snapshot.home) kept.home = snapshot.home;
    if (snapshot.homeCleared === true && !snapshot.home) kept.clearHome = true;
    return kept;
  }
  const code = normalizeRecoveryCode(recoveryCode);
  if (!code) return keepStoredHistory(snapshot);
  const device = await ensureDevice(storage);
  const vault = await wrapVault(code, device);
  const content = contentKeyBytes(device);
  const sealedHistory = content
    ? await sealJson(content, device.publicKey, {
      journeys: Array.isArray(snapshot.journeys) ? snapshot.journeys : [],
      visits: Array.isArray(snapshot.visits) ? snapshot.visits : [],
      home: snapshot.home || null,
    })
    : null;
  if (!vault || !sealedHistory) return { ...snapshot, keepHistory: true };
  const historyShares = await historySharesFor(content, snapshot.historyPeers);
  const packed = {
    ...snapshot,
    vault,
    sealedHistory,
    dropRecovery: true,
    keepHistory: false,
    journeys: [],
    visits: [],
    home: null,
  };
  delete packed.historyPeers;
  if (historyShares && Object.keys(historyShares).length) packed.historyShares = historyShares;
  return packed;
}

export async function historySharesFor(contentKey, peers) {
  const raw = contentKey instanceof Uint8Array ? contentKey : base64UrlToBytes(contentKey);
  const shares = {};
  if (!raw || raw.length !== 32) return shares;
  for (const peer of Array.isArray(peers) ? peers : []) {
    if (!peer || typeof peer.memberId !== 'string' || typeof peer.publicKey !== 'string') continue;
    const wrap = await wrapFamilyKey(peer.publicKey, raw, HISTORY_SHARE_KID);
    if (wrap) shares[peer.memberId] = wrap;
  }
  return shares;
}

function sameBytes(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function contentKeyStillHeld(shares, privateKey, raw) {
  for (const wrap of Object.values(shares || {})) {
    const opened = await unwrapFamilyKey(privateKey, wrap, HISTORY_SHARE_KID);
    if (opened && sameBytes(opened, raw)) return true;
  }
  return false;
}

export async function syncHistoryDirectory({ history, pubs, memberId, privateKey, contentKey }) {
  const book = {};
  const source = history && typeof history === 'object' ? history : {};
  for (const [ownerId, shares] of Object.entries(source)) {
    book[ownerId] = shares && typeof shares === 'object' ? { ...shares } : {};
  }
  const raw = contentKey instanceof Uint8Array ? contentKey : base64UrlToBytes(contentKey);
  const mine = book[memberId];
  const rowIsNew = !mine || Object.keys(mine).length === 0;
  // A new phone mints a content key that does not open sealedHistory.
  // Fill a missing slot only when this phone still holds the key already shared,
  // or when this account has never published a history key.
  const mayPublish = raw && raw.length === 32 && (rowIsNew || await contentKeyStillHeld(mine, privateKey, raw));
  if (mayPublish) {
    const next = { ...(mine || {}) };
    let added = false;
    for (const [id, pub] of Object.entries(pubs || {})) {
      if (typeof pub !== 'string' || next[id]) continue;
      const wrap = await wrapFamilyKey(pub, raw, HISTORY_SHARE_KID);
      if (wrap) {
        next[id] = wrap;
        added = true;
      }
    }
    if (added) book[memberId] = next;
  }
  // A family phone that can open someone else's history key rewraps that key
  // to the public keys now in the room. A reinstall cannot open the old wraps,
  // so it does not overwrite them.
  const refreshed = await rewrapHistoryShares({
    history: book,
    pubs,
    holderId: memberId,
    holderPrivate: privateKey,
  });
  const selfShare = refreshed[memberId] && refreshed[memberId][memberId];
  return { history: refreshed, selfShare: selfShare || null };
}

export function historyShareToSave(memberId, history, mergedFrom, selfShare) {
  const row = mergedFrom && history && typeof history === 'object' ? history[mergedFrom] : null;
  const adopted = row && typeof row === 'object' ? row[memberId] : null;
  if (adopted && adopted.epk && adopted.iv && adopted.ct) return adopted;
  return selfShare || null;
}

const historyWrapCache = new Map();

function historyWrapKey(holderId, ownerId, memberId, pub, key) {
  return `${holderId}\0${ownerId}\0${memberId}\0${pub}\0${bytesToBase64Url(key)}`;
}

export async function rewrapHistoryShares({ history, pubs, holderId, holderPrivate }) {
  const next = {};
  const book = history && typeof history === 'object' ? history : {};
  for (const [ownerId, shares] of Object.entries(book)) {
    next[ownerId] = shares && typeof shares === 'object' ? { ...shares } : {};
  }
  for (const [ownerId, shares] of Object.entries(next)) {
    const mine = shares[holderId];
    if (!mine) continue;
    const key = await unwrapFamilyKey(holderPrivate, mine, HISTORY_SHARE_KID);
    if (!key) continue;
    for (const [id, pub] of Object.entries(pubs || {})) {
      if (typeof pub !== 'string') continue;
      const cacheKey = historyWrapKey(holderId, ownerId, id, pub, key);
      const cached = historyWrapCache.get(cacheKey);
      if (cached) {
        shares[id] = cached;
        continue;
      }
      if (shares[id] && historyWrapCache.get(`bound\0${holderId}\0${ownerId}\0${id}`) === pub) {
        historyWrapCache.set(cacheKey, shares[id]);
        continue;
      }
      const wrap = await wrapFamilyKey(pub, key, HISTORY_SHARE_KID);
      if (!wrap) continue;
      shares[id] = wrap;
      historyWrapCache.set(cacheKey, wrap);
      historyWrapCache.set(`bound\0${holderId}\0${ownerId}\0${id}`, pub);
    }
  }
  return next;
}

export async function openAccountSecrets(account, storage, typedCode = '') {
  if (!account || typeof account !== 'object') return account;
  const typed = normalizeRecoveryCode(typedCode);
  if (typed && storage) {
    const { writeStoredRecoveryCode } = await import('./accountRestore.mjs');
    writeStoredRecoveryCode(storage, typed);
  }
  const { readStoredRecoveryCode } = await import('./accountRestore.mjs');
  const known = typed || normalizeRecoveryCode(readStoredRecoveryCode(storage));
  if (account.recoveryCode && storage) {
    const { writeStoredRecoveryCode } = await import('./accountRestore.mjs');
    writeStoredRecoveryCode(storage, account.recoveryCode);
  }
  const code = known || normalizeRecoveryCode(readStoredRecoveryCode(storage));
  let openedVault = false;
  if (account.vault && code) {
    const device = await unwrapVault(code, account.vault);
    if (device) {
      writeDevice(storage, device);
      openedVault = true;
    }
  }
  let mergedPlain = null;
  if (!openedVault && account.mergedVault && code && account.sealedHistory) {
    const candidate = await unwrapVault(code, account.mergedVault);
    const opened = candidate ? await openJson(contentKeyBytes(candidate), account.sealedHistory) : null;
    if (opened && typeof opened === 'object') {
      writeDevice(storage, candidate);
      mergedPlain = opened;
    }
  }
  if (!readDevice(storage)) await ensureDevice(storage);
  let journeys = account.journeys;
  let visits = account.visits;
  let home = account.home;
  let historyLocked = false;
  if (account.sealedHistory) {
    let opened = mergedPlain || await openJson(contentKeyBytes(readDevice(storage)), account.sealedHistory);
    if (!opened) {
      const device = readDevice(storage);
      const saved = readJson(storage, HISTORY_SHARE_STORAGE);
      const book = account.historyShares && typeof account.historyShares === 'object' ? account.historyShares : null;
      const share = (book && book[account.memberId]) || (saved && saved.memberId === account.memberId ? saved.wrap : null);
      const key = device && share ? await unwrapFamilyKey(device.privateKey, share, HISTORY_SHARE_KID) : null;
      if (key) opened = await openJson(key, account.sealedHistory);
    }
    if (opened && typeof opened === 'object') {
      journeys = Array.isArray(opened.journeys) ? opened.journeys : [];
      visits = Array.isArray(opened.visits) ? opened.visits : [];
      home = account.clearHome ? null : (account.home || opened.home || null);
    } else if (!Array.isArray(account.journeys) || account.journeys.length === 0) {
      historyLocked = true;
    }
  }
  return { ...account, journeys, visits, home, historyLocked };
}
