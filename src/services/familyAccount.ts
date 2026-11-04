import {
  ACCOUNT_KEY_STORAGE,
  RECOVERY_CODE_STORAGE,
  applyAccountSnapshot,
  currentAccountBackupEpoch,
  interpretAccountDelete,
  invalidateAccountBackup,
  persistAccountSecretsIfCurrent,
  readStoredAccountKey,
  readStoredRecoveryCode,
  rememberAccountSecrets,
  snapshotFromSession,
  writeStoredAccountKey,
  writeStoredRecoveryCode,
} from '../lib/accountRestore.mjs';
import { prepareBackup } from '../lib/familyVault.mjs';
import { readDiagEvents } from '../lib/diagLog.mjs';
import { familySyncUrl } from './familySync';

export {
  ACCOUNT_KEY_STORAGE,
  RECOVERY_CODE_STORAGE,
  applyAccountSnapshot,
  readStoredAccountKey,
  readStoredRecoveryCode,
  rememberAccountSecrets,
  snapshotFromSession,
  writeStoredAccountKey,
  writeStoredRecoveryCode,
};

export interface AccountSnapshot {
  memberId: string;
  profileKey: string;
  profile: { name: string; photo?: string | null };
  room: { code: string; writeKey: string; readKey: string };
  guardians?: unknown[];
  home?: unknown;
  journeys?: unknown[];
  visits?: unknown[];
  recoveryCode?: string;
  accountKey?: string;
  googleLinked?: boolean;
  kakaoLinked?: boolean;
  naverLinked?: boolean;
  nameChosen?: boolean;
  created?: boolean;
  restored?: boolean;
  roster?: Array<{ id: string; name: string; role?: string; publisherId?: string; inviteCode?: string }>;
  historyShares?: Record<string, { epk: string; iv: string; ct: string }>;
  vault?: unknown;
  sealedHistory?: unknown;
  historyLocked?: boolean;
  mergedFrom?: string;
  mergedVault?: unknown;
  keepHistory?: boolean;
  dropRecovery?: boolean;
}

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const base = familySyncUrl();
  if (!base) throw new Error('off');
  return fetch(`${base}${path}`, { ...init, signal: timeoutSignal(10_000), cache: 'no-store' });
}

function accountHeaders(accountKey?: string): Headers {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (accountKey) headers.set('x-umap-account-key', accountKey);
  return headers;
}

async function readAccountBody(response: Response): Promise<{ ok: boolean; account?: AccountSnapshot; restored?: boolean; created?: boolean; message?: string; detail?: string; conflict?: boolean }> {
  const body = await response.json().catch(() => null) as { ok?: boolean; account?: AccountSnapshot; restored?: boolean; message?: string; reason?: string; error?: string } | null;
  if (!response.ok || !body || body.ok !== true || !body.account) {
    const detail = body && typeof body.reason === 'string' ? body.reason : (body && body.error === 'upstream' ? 'upstream' : undefined);
    return {
      ok: false,
      conflict: body?.error === 'member',
      message: body && typeof body.message === 'string' ? body.message : '계정을 불러오지 못했습니다.',
      detail,
    };
  }
  return {
    ok: true,
    account: body.account,
    restored: body.restored === true,
    created: body.account.created === true,
  };
}

async function sealedSnapshot(snapshot: AccountSnapshot) {
  const storage = typeof localStorage === 'undefined' ? null : localStorage;
  return prepareBackup(snapshot, storage, readStoredRecoveryCode(storage));
}

export async function registerFamilyAccount(snapshot: AccountSnapshot) {
  const response = await request('/v1/account', {
    method: 'POST',
    headers: accountHeaders(),
    body: JSON.stringify(await sealedSnapshot(snapshot)),
  });
  return readAccountBody(response);
}

export async function loadFamilyAccount(accountKey = readStoredAccountKey(typeof localStorage === 'undefined' ? null : localStorage)) {
  if (!accountKey) return { ok: false as const, message: '계정이 없습니다.' };
  const response = await request('/v1/account', {
    method: 'GET',
    headers: accountHeaders(accountKey),
  });
  return readAccountBody(response);
}

export async function backupFamilyAccount(snapshot: AccountSnapshot, accountKey = readStoredAccountKey(localStorage)) {
  if (!accountKey) return registerFamilyAccount(snapshot);
  const response = await request('/v1/account', {
    method: 'PUT',
    headers: accountHeaders(accountKey),
    body: JSON.stringify(await sealedSnapshot(snapshot)),
  });
  return readAccountBody(response);
}

export type DisclosureCategory = 'name' | 'kakao' | 'naver' | 'family' | 'device' | 'account' | 'location' | 'history' | 'place' | 'other';

export interface DisclosureRecord {
  categories: DisclosureCategory[];
  detail?: string;
  rangeStart: number;
  rangeEnd: number;
  recipient: string;
  purpose: string;
  at: number;
  actor: string;
}

function cleanDisclosure(value: unknown): DisclosureRecord | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if ('lat' in row || 'lng' in row || 'latitude' in row || 'longitude' in row) return null;
  if ('kakaoId' in row || 'naverId' in row || 'recoveryCode' in row || 'accountKey' in row) return null;
  if (!Array.isArray(row.categories) || !row.categories.length) return null;
  const categories: DisclosureCategory[] = [];
  for (const item of row.categories) {
    if (item !== 'name' && item !== 'kakao' && item !== 'naver' && item !== 'family' && item !== 'device' && item !== 'account' && item !== 'location' && item !== 'history' && item !== 'place' && item !== 'other') return null;
    if (!categories.includes(item)) categories.push(item);
  }
  if (typeof row.rangeStart !== 'number' || typeof row.rangeEnd !== 'number' || typeof row.at !== 'number') return null;
  if (!Number.isInteger(row.rangeStart) || !Number.isInteger(row.rangeEnd) || !Number.isInteger(row.at)) return null;
  if (typeof row.recipient !== 'string' || typeof row.purpose !== 'string' || typeof row.actor !== 'string') return null;
  if (!row.recipient || !row.purpose || !row.actor) return null;
  const detail = typeof row.detail === 'string' && row.detail ? row.detail : '';
  if (categories.includes('other') && !detail) return null;
  return {
    categories,
    ...(detail ? { detail } : {}),
    rangeStart: row.rangeStart,
    rangeEnd: row.rangeEnd,
    recipient: row.recipient,
    purpose: row.purpose,
    at: row.at,
    actor: row.actor,
  };
}

export interface HandlingEvent {
  kind: 'collect' | 'use';
  memberId: string;
  actor: string;
  categories: Array<'location' | 'history' | 'place'>;
  at: number;
}

export async function uploadDiagReport(accountKey = readStoredAccountKey(typeof localStorage === 'undefined' ? null : localStorage)): Promise<{ ok: boolean; id?: string; message?: string }> {
  if (!accountKey || !familySyncUrl()) return { ok: false, message: '로그인된 계정이 있어야 보냅니다. 카카오·네이버 또는 복구 코드로 들어온 뒤에 보내 주세요.' };
  const events = readDiagEvents();
  if (events.length === 0) return { ok: false, message: '보낼 진단 기록이 없습니다. 잠시 움직인 뒤에 다시 보내 주세요.' };
  let batch = events;
  while (JSON.stringify(batch).length > 180_000 && batch.length > 1) batch = batch.slice(Math.ceil(batch.length / 5));
  try {
    const response = await request('/v1/diag', {
      method: 'POST',
      headers: accountHeaders(accountKey),
      body: JSON.stringify({ events: batch }),
    });
    const body = await response.json().catch(() => null) as { ok?: boolean; id?: string; error?: string } | null;
    if (!response.ok || !body || body.ok !== true || typeof body.id !== 'string') {
      return { ok: false, message: response.status === 404 ? '저장된 계정을 찾지 못했습니다.' : '올리지 못했습니다.' };
    }
    return { ok: true, id: body.id };
  } catch {
    return { ok: false, message: '위치 서버에 연결되지 않아 올리지 못했습니다.' };
  }
}

export async function loadOwnHandling(accountKey = readStoredAccountKey(typeof localStorage === 'undefined' ? null : localStorage)): Promise<{
  ok: boolean;
  intact: boolean;
  events: HandlingEvent[];
  message?: string;
}> {
  if (!accountKey || !familySyncUrl()) return { ok: false, intact: true, events: [], message: '위치 서버에 연결되지 않아 이용 기록을 확인하지 못했습니다.' };
  try {
    const response = await request('/v1/account/handling', { method: 'GET', headers: accountHeaders(accountKey) });
    const body = await response.json().catch(() => null) as { ok?: boolean; intact?: boolean; events?: unknown } | null;
    if (!response.ok || !body || body.ok !== true || !Array.isArray(body.events)) {
      return { ok: false, intact: true, events: [], message: '이용 기록을 불러오지 못했습니다.' };
    }
    const events: HandlingEvent[] = [];
    for (const item of body.events) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (row.kind !== 'collect' && row.kind !== 'use') continue;
      if (typeof row.at !== 'number' || typeof row.actor !== 'string') continue;
      if (!Array.isArray(row.categories)) continue;
      events.push({
        kind: row.kind,
        memberId: typeof row.memberId === 'string' ? row.memberId : '',
        actor: row.actor,
        categories: row.categories.filter((category): category is HandlingEvent['categories'][number] => category === 'location' || category === 'history' || category === 'place'),
        at: row.at,
      });
    }
    return { ok: true, intact: body.intact !== false, events };
  } catch {
    return { ok: false, intact: true, events: [], message: '이용 기록을 불러오지 못했습니다.' };
  }
}

export async function mintFamilyInvite(code: string, syncToken: string, memberId: string, link = false) {
  if (!familySyncUrl()) return { ok: false as const, message: '위치 서버가 없습니다.' };
  try {
    const response = await request('/v1/invites', {
      method: 'POST',
      headers: accountHeaders(link ? readStoredAccountKey(typeof localStorage === 'undefined' ? null : localStorage) : ''),
      body: JSON.stringify(link ? { code, link: true } : { code, syncToken, memberId }),
    });
    const body = await response.json().catch(() => null) as { ok?: boolean; ticket?: string; message?: string } | null;
    if (!response.ok || !body || body.ok !== true || typeof body.ticket !== 'string') {
      return { ok: false as const, message: '초대 링크를 만들지 못했습니다.' };
    }
    return { ok: true as const, ticket: body.ticket };
  } catch {
    return { ok: false as const, message: '초대 링크를 만들지 못했습니다.' };
  }
}

export async function revokeFamilyInvite(ticket: string) {
  if (!familySyncUrl()) return { ok: false as const, message: '위치 서버가 없습니다.' };
  try {
    const response = await request(`/v1/invites/${encodeURIComponent(ticket)}/revoke`, {
      method: 'POST',
      headers: accountHeaders(readStoredAccountKey(typeof localStorage === 'undefined' ? null : localStorage)),
      body: '{}',
    });
    if (!response.ok) return { ok: false as const, message: '초대를 취소하지 못했습니다.' };
    return { ok: true as const };
  } catch {
    return { ok: false as const, message: '초대를 취소하지 못했습니다.' };
  }
}

export async function redeemFamilyInvite(ticket: string) {
  if (!familySyncUrl()) return { ok: false as const, message: '위치 서버가 없습니다.' };
  try {
    const response = await request(`/v1/invites/${encodeURIComponent(ticket)}/redeem`, {
      method: 'POST',
      headers: accountHeaders(),
      body: '{}',
    });
    const body = await response.json().catch(() => null) as { ok?: boolean; code?: string; syncToken?: string; ownerMemberId?: string; message?: string } | null;
    if (!response.ok || !body || body.ok !== true || typeof body.code !== 'string') {
      return { ok: false as const, message: body && typeof body.message === 'string' ? body.message : '초대 링크를 확인하지 못했습니다.' };
    }
    return {
      ok: true as const,
      code: body.code,
      syncToken: typeof body.syncToken === 'string' ? body.syncToken : '',
      ownerMemberId: typeof body.ownerMemberId === 'string' ? body.ownerMemberId : '',
    };
  } catch {
    return { ok: false as const, message: '초대 링크를 확인하지 못했습니다.' };
  }
}

export async function loadOwnDisclosures(accountKey = readStoredAccountKey(typeof localStorage === 'undefined' ? null : localStorage)): Promise<{
  ok: boolean;
  intact: boolean;
  disclosures: DisclosureRecord[];
  message?: string;
}> {
  if (!accountKey || !familySyncUrl()) {
    return { ok: false, intact: true, disclosures: [], message: '위치 서버에 연결되지 않아 제공 기록을 확인하지 못했습니다.' };
  }
  try {
    const response = await request('/v1/account/disclosures', {
      method: 'GET',
      headers: accountHeaders(accountKey),
    });
    const body = await response.json().catch(() => null) as { ok?: boolean; intact?: boolean; disclosures?: unknown } | null;
    if (!response.ok || !body || body.ok !== true || !Array.isArray(body.disclosures)) {
      return { ok: false, intact: true, disclosures: [], message: '제공 기록을 불러오지 못했습니다.' };
    }
    return {
      ok: true,
      intact: body.intact !== false,
      disclosures: body.disclosures.map(cleanDisclosure).filter((row): row is DisclosureRecord => row !== null),
    };
  } catch {
    return { ok: false, intact: true, disclosures: [], message: '제공 기록을 불러오지 못했습니다.' };
  }
}

export async function deleteFamilyAccount(accountKey = readStoredAccountKey(typeof localStorage === 'undefined' ? null : localStorage)) {
  if (!accountKey) return { ok: false, message: '저장된 계정을 찾지 못했습니다.' };
  try {
    const response = await request('/v1/account', {
      method: 'DELETE',
      headers: accountHeaders(accountKey),
    });
    const body = await response.json().catch(() => null) as { ok?: boolean; message?: string } | null;
    return interpretAccountDelete(response.status, body);
  } catch {
    return { ok: false, message: '계정을 지우지 못했습니다. 위치 서버에 다시 연결해 주세요.' };
  }
}

export async function recoverFamilyAccount(code: string) {
  const response = await request('/v1/account/recover', {
    method: 'POST',
    headers: accountHeaders(),
    body: JSON.stringify({ code }),
  });
  return readAccountBody(response);
}

export async function linkKakaoAccount(
  accessToken: string,
  snapshot?: AccountSnapshot | null,
  mode: 'login' | 'link' = 'login',
  merge = false,
) {
  const accountKey = mode === 'link' || merge
    ? readStoredAccountKey(typeof localStorage === 'undefined' ? null : localStorage)
    : '';
  const response = await request('/v1/account/kakao', {
    method: 'POST',
    headers: accountHeaders(accountKey),
    body: JSON.stringify({
      accessToken,
      mode,
      ...(merge ? { merge: true } : {}),
      ...(snapshot ? { snapshot: await sealedSnapshot(snapshot) } : {}),
      ...(accountKey ? { accountKey } : {}),
    }),
  });
  return readAccountBody(response);
}

export async function linkNaverAccount(
  payload: { accessToken?: string; code?: string; state?: string; redirectUri?: string },
  snapshot?: AccountSnapshot | null,
  mode: 'login' | 'link' = 'login',
) {
  const accountKey = mode === 'link'
    ? readStoredAccountKey(typeof localStorage === 'undefined' ? null : localStorage)
    : '';
  const response = await request('/v1/account/naver', {
    method: 'POST',
    headers: accountHeaders(accountKey),
    body: JSON.stringify({
      mode,
      ...(payload.accessToken ? { accessToken: payload.accessToken } : {}),
      ...(payload.code ? { code: payload.code } : {}),
      ...(payload.state ? { state: payload.state } : {}),
      ...(payload.redirectUri ? { redirectUri: payload.redirectUri } : {}),
      ...(snapshot ? { snapshot: await sealedSnapshot(snapshot) } : {}),
      ...(accountKey ? { accountKey } : {}),
    }),
  });
  return readAccountBody(response);
}

export async function persistAccountResult(result: { ok: boolean; account?: AccountSnapshot }) {
  if (!result.ok || !result.account) return;
  rememberAccountSecrets(localStorage, result.account);
}

let backupTimer = 0;
let backupInflight = false;

export function cancelAccountBackup() {
  if (typeof window !== 'undefined') window.clearTimeout(backupTimer);
  backupTimer = 0;
  invalidateAccountBackup();
}

export function scheduleAccountBackup(state: unknown) {
  if (typeof window === 'undefined' || !familySyncUrl()) return;
  const snapshot = snapshotFromSession(state);
  if (!snapshot) return;
  const epoch = currentAccountBackupEpoch();
  window.clearTimeout(backupTimer);
  backupTimer = window.setTimeout(() => {
    if (backupInflight || epoch !== currentAccountBackupEpoch()) return;
    backupInflight = true;
    void backupFamilyAccount(snapshot)
      .then((result) => {
        if (!result.ok || !result.account) return;
        persistAccountSecretsIfCurrent(
          typeof localStorage === 'undefined' ? null : localStorage,
          result.account,
          epoch,
        );
      })
      .catch(() => undefined)
      .finally(() => {
        backupInflight = false;
      });
  }, 1600);
}
