// The durable family session. Since 1.36 the only localStorage copy of
// umap_family_v1 on a phone is an Android Keystore seal. sessionStorage, the
// plaintext copy, dies when an update kills the process. load() then returns
// an empty session until the seal opens. A later persist with a profile seals
// that empty session over the old one, and an empty backup replaces the
// server history. The plain key below is readable without Keystore, and an
// unread seal is never replaced by an empty session.

export const FAMILY_STORAGE_KEY = 'umap_family_v1';
export const PLAIN_SESSION_KEY = 'umap_family_v1_plain';
export const DEVICE_SEAL_PREFIX = 'umap-device-seal:';

const SESSION_KEYS = [FAMILY_STORAGE_KEY, `${FAMILY_STORAGE_KEY}:admin`, `${FAMILY_STORAGE_KEY}:managed`];

export function parseStoredSession(raw) {
  if (typeof raw !== 'string' || !raw || raw.startsWith(DEVICE_SEAL_PREFIX)) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (typeof parsed.inviteCode !== 'string' || !Array.isArray(parsed.members) || !parsed.permissions) return null;
    return parsed;
  } catch {
    return null;
  }
}

function bagCount(bag) {
  if (!bag || typeof bag !== 'object') return 0;
  let count = 0;
  for (const list of Object.values(bag)) {
    if (Array.isArray(list)) count += list.length;
  }
  return count;
}

export function recordBags(session) {
  return {
    journeys: bagCount(session && session.journeys),
    visits: bagCount(session && session.visits),
    tracks: bagCount(session && session.tracks),
  };
}

export function historyScore(session) {
  const bags = recordBags(session);
  return bags.journeys + bags.visits + bags.tracks;
}

/** Journeys and visits are the 기록 tab. Tracks alone still count as stored history. */
export function needsHistoryRestore(session) {
  const bags = recordBags(session);
  return bags.journeys === 0 && bags.visits === 0;
}

export function readSeal(storage) {
  try {
    const raw = storage && storage.getItem(FAMILY_STORAGE_KEY);
    return raw && raw.startsWith(DEVICE_SEAL_PREFIX) ? raw : '';
  } catch {
    return '';
  }
}

export function collectJsonSnapshots(localStorage, sessionStorage) {
  const found = [];
  const push = (raw, at) => {
    const parsed = parseStoredSession(raw);
    if (parsed) found.push({ ...parsed, savedAt: at });
  };
  try {
    const tab = sessionStorage && sessionStorage.getItem(FAMILY_STORAGE_KEY);
    if (tab) push(tab, Date.now());
  } catch {
    /* 탭 저장이 없어도 디스크 복사본을 읽는다 */
  }
  if (!localStorage) return found;
  try {
    const plain = localStorage.getItem(PLAIN_SESSION_KEY);
    if (plain) push(plain, Number(localStorage.getItem(`${PLAIN_SESSION_KEY}:at`) || 0));
    for (const key of SESSION_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw) push(raw, Number(localStorage.getItem(`${key}:at`) || 0));
    }
  } catch {
    /* 깨진 저장은 건너뛴다 */
  }
  return found;
}

export function richerStoredRaw(localStorage, next) {
  if (!localStorage || historyScore(next) > 0) return '';
  try {
    const raw = localStorage.getItem(PLAIN_SESSION_KEY) || '';
    const stored = parseStoredSession(raw);
    if (stored && historyScore(stored) > 0) return raw;
  } catch {
    return '';
  }
  return '';
}

export function writePlainSession(localStorage, raw) {
  if (!localStorage || typeof raw !== 'string') return;
  localStorage.setItem(PLAIN_SESSION_KEY, raw);
  localStorage.setItem(`${PLAIN_SESSION_KEY}:at`, String(Date.now()));
}

export function clearPlainSession(localStorage) {
  if (!localStorage) return;
  try {
    localStorage.removeItem(PLAIN_SESSION_KEY);
    localStorage.removeItem(`${PLAIN_SESSION_KEY}:at`);
  } catch {
    /* 로그아웃은 이어서 봉인도 지운다 */
  }
}

/**
 * Write the next session. An unread device seal is left untouched so a failed
 * unseal cannot replace real journeys with an empty login. A plain copy that
 * already has records is also kept when the next session has none.
 */
export function commitDurableSession(localStorage, nextSession, nextRaw, options = {}) {
  if (!localStorage || typeof nextRaw !== 'string') return { wrote: false, reason: 'missing' };
  const richer = richerStoredRaw(localStorage, nextSession);
  if (richer) return { wrote: false, plain: richer, reason: 'richer-plain' };
  if (options.unreadSeal && readSeal(localStorage)) {
    return { wrote: false, reason: 'hold-seal' };
  }
  writePlainSession(localStorage, nextRaw);
  const sealText = options.sealText;
  if (typeof sealText === 'string' && sealText.startsWith(DEVICE_SEAL_PREFIX)) {
    localStorage.setItem(FAMILY_STORAGE_KEY, sealText);
  } else if (sealText === null) {
    localStorage.setItem(FAMILY_STORAGE_KEY, nextRaw);
  }
  localStorage.setItem(`${FAMILY_STORAGE_KEY}:at`, String(Date.now()));
  return { wrote: true, reason: 'written' };
}

/** Server history is a self list. Fill only the bags that are empty on this phone. */
export function fillFromAccount(account) {
  if (!account || typeof account !== 'object') return null;
  const journeys = Array.isArray(account.journeys) ? account.journeys : [];
  const visits = Array.isArray(account.visits) ? account.visits : [];
  const home = account.home && typeof account.home === 'object' ? account.home : null;
  if (!journeys.length && !visits.length && !home) return null;
  return { journeys, visits, home };
}
