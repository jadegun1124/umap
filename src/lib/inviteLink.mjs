export function buildGroupInviteLink(origin, code, ticket, syncToken) {
  const url = new URL('/invite', origin);
  url.searchParams.set('code', code);
  url.searchParams.set('ticket', ticket);
  url.hash = `k=${encodeURIComponent(syncToken)}`;
  return url.toString();
}

export function syncTokenFromInviteFragment(value) {
  const raw = value.startsWith('#') ? value.slice(1) : value;
  const token = new URLSearchParams(raw).get('k') || '';
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]{16,64}$/.test(parts[0]) || !/^[A-Za-z0-9_-]{16,128}$/.test(parts[1])) return null;
  return token;
}
