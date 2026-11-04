// One-time family invite. The room sync token stays off the link until redeem,
// then the ticket is deleted. A second redeem or an expired ticket fails.

const CODE_PART = /^\d{4,6}$/;
const TICKET_PART = /^[A-Za-z0-9_-]{16,64}$/;
const TOKEN_PART = /^[A-Za-z0-9_-]{16,64}\.[A-Za-z0-9_-]{16,128}$/;
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
export const LINK_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LINK_INVITE_MAX_USES = 20;
const REDEEM_LIMIT = 30;

function ticketId() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function inviteKey(id) {
  return `invite:${id}`;
}

export async function mintInvite(store, { code, syncToken, memberId, link }, now = Date.now()) {
  if (!CODE_PART.test(code || '')) return { error: 'code' };
  const owner = typeof memberId === 'string' ? memberId.slice(0, 80) : '';
  const id = ticketId();
  if (link === true) {
    const exp = now + LINK_INVITE_TTL_MS;
    await store.put(inviteKey(id), {
      code,
      memberId: owner,
      link: true,
      exp,
      uses: 0,
      maxUses: LINK_INVITE_MAX_USES,
      revoked: false,
    });
    return { ok: true, ticket: id, exp, link: true };
  }
  if (typeof syncToken !== 'string' || !TOKEN_PART.test(syncToken)) return { error: 'sync' };
  const exp = now + INVITE_TTL_MS;
  await store.put(inviteKey(id), {
    code,
    syncToken,
    memberId: owner,
    exp,
  });
  return { ok: true, ticket: id, exp };
}

async function noteRedeem(store, now) {
  const bucket = `invite-rate:${Math.floor(now / 60_000)}`;
  const count = Number(await store.get(bucket)) || 0;
  if (count >= REDEEM_LIMIT) return false;
  await store.put(bucket, count + 1);
  return true;
}

export async function redeemInvite(store, ticket, now = Date.now()) {
  if (typeof ticket !== 'string' || !TICKET_PART.test(ticket)) return { error: 'invite' };
  if (!(await noteRedeem(store, now))) return { error: 'limited' };
  const row = await store.get(inviteKey(ticket));
  if (!row || typeof row !== 'object') return { error: 'invite' };
  if (row.revoked === true) return { error: 'revoked' };
  if (!Number.isInteger(row.exp) || row.exp <= now) return { error: 'expired' };
  if (!CODE_PART.test(row.code)) return { error: 'invite' };
  if (row.link === true) {
    const uses = Number(row.uses) || 0;
    const maxUses = Number(row.maxUses) || LINK_INVITE_MAX_USES;
    if (uses >= maxUses) return { error: 'invite' };
    await store.put(inviteKey(ticket), { ...row, uses: uses + 1 });
    return { ok: true, code: row.code, ownerMemberId: row.memberId || '', link: true };
  }
  await store.delete(inviteKey(ticket));
  if (typeof row.syncToken !== 'string') return { error: 'invite' };
  return { ok: true, code: row.code, syncToken: row.syncToken };
}

export async function revokeInvite(store, ticket, ownerMemberId) {
  if (typeof ticket !== 'string' || !TICKET_PART.test(ticket)) return { error: 'invite' };
  const row = await store.get(inviteKey(ticket));
  if (!row || row.link !== true) return { error: 'invite' };
  if (!ownerMemberId || row.memberId !== ownerMemberId) return { error: 'account' };
  await store.put(inviteKey(ticket), { ...row, revoked: true });
  return { ok: true };
}

export function inviteLandingResponse(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (request.method === 'GET' && path === '/.well-known/assetlinks.json') {
    return new Response(JSON.stringify([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'kr.co.umap.tracker',
        sha256_cert_fingerprints: ['4A:15:08:0F:72:C3:87:D1:E8:50:A8:DE:5A:89:34:9A:B4:1A:48:0D:C5:97:71:AB:22:9C:85:44:C8:61:7A:6C'],
      },
    }]), { headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
  if (request.method !== 'GET' || path !== '/invite') return null;
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kinnex 가족 초대</title><body style="font-family:sans-serif;padding:24px;line-height:1.6"><h1>Kinnex 가족 초대</h1><p>이 링크로 Kinnex를 열면 가족 구성원이 함께 보입니다. 앱이 없으면 설치한 뒤 이 링크를 다시 여세요.</p><p><a id="open" href="kinnex://invite">Kinnex 열기</a></p><script>var open=document.getElementById('open');var target='kinnex://invite'+location.search+location.hash;open.href=target;location.replace(target);</script></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
