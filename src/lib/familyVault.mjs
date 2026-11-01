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
  unwrapVault,
  wrapVault,
} from './familySeal.mjs';

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
  if (snapshotHistoryEmpty(snapshot)) return keepStoredHistory(snapshot);
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
  return {
    ...snapshot,
    vault,
    sealedHistory,
    dropRecovery: true,
    keepHistory: false,
    journeys: [],
    visits: [],
    home: null,
  };
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
  if (account.vault && code) {
    const device = await unwrapVault(code, account.vault);
    if (device) writeDevice(storage, device);
  }
  if (!readDevice(storage)) await ensureDevice(storage);
  let journeys = account.journeys;
  let visits = account.visits;
  let home = account.home;
  let historyLocked = false;
  if (account.sealedHistory) {
    const opened = await openJson(contentKeyBytes(readDevice(storage)), account.sealedHistory);
    if (opened && typeof opened === 'object') {
      journeys = Array.isArray(opened.journeys) ? opened.journeys : [];
      visits = Array.isArray(opened.visits) ? opened.visits : [];
      home = opened.home || null;
    } else if (!Array.isArray(account.journeys) || account.journeys.length === 0) {
      historyLocked = true;
    }
  }
  return { ...account, journeys, visits, home, historyLocked };
}
