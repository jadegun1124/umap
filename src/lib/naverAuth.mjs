// Naver Login (네아로). The Naver id is never the family member id.
// The client id is public. NAVER_CLIENT_SECRET stays on the Worker only.

export const PUBLIC_NAVER_CLIENT_ID = 'dQCiRLIzbNkDG6ULiroD';

export const NAVER_SETUP_MESSAGE = [
  '네이버 로그인을 마치지 못했습니다. 이 상태로 시작하지 않습니다.',
  '1. Naver Developers에서 애플리케이션을 만들고 네아로를 켭니다.',
  '2. Android 패키지는 kr.co.umap.tracker 이고, 다운로드 URL은 GitHub Releases APK입니다.',
  '3. VITE_NAVER_CLIENT_ID에 Client ID를 넣고, Worker에는 NAVER_CLIENT_SECRET을 넣습니다.',
].join('\n');

export const NAVER_VERIFY_MESSAGE = '네이버 로그인 토큰이 거절되었습니다. 다시 로그인해 주세요.';
export const NAVER_CANCEL_MESSAGE = '네이버 로그인을 취소했습니다.';
export const NAVER_SERVER_MISSING_MESSAGE = '위치 서버 주소가 없어 네이버 로그인을 시작하지 않습니다.';
export const NAVER_NATIVE_FAILED_MESSAGE = '네이버 로그인 창이 실패했습니다. 다시 시도해 주세요.';
export const NAVER_SERVER_UNREACHABLE_MESSAGE = '위치 서버에 연결하지 못해 네이버 로그인을 마치지 못했습니다.';
export const NAVER_REDIRECT = 'kinnex://naver';
export const NAVER_APP_REDIRECT = 'https://umap-family-sync.umap-jadegun.workers.dev/v1/naver/callback';

export function naverClientId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || /your-|placeholder|example/i.test(id)) return '';
  if (id.length < 8 || id.length > 64) return '';
  return id;
}

export function naverClientIdOrPublic(value) {
  return naverClientId(value) || naverClientId(PUBLIC_NAVER_CLIENT_ID);
}

export function naverRedirectUri() {
  if (typeof window === 'undefined') return NAVER_REDIRECT;
  const origin = window.location.origin;
  const path = window.location.pathname || '/';
  if (origin.startsWith('https://') || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
    return allowedNaverRedirect(`${origin}${path}`) || NAVER_REDIRECT;
  }
  return NAVER_REDIRECT;
}

export function allowedNaverRedirect(value) {
  const uri = typeof value === 'string' ? value.trim() : '';
  if (!uri || uri.length > 200) return '';
  if (uri === NAVER_APP_REDIRECT) return uri;
  if (uri === NAVER_REDIRECT) return uri;
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    return '';
  }
  if (parsed.protocol === 'kinnex:' && parsed.host === 'naver') return NAVER_REDIRECT;
  if (parsed.protocol === 'https:' && parsed.hostname === 'jadegun1124.github.io') {
    if (parsed.pathname === '/kinnex' || parsed.pathname === '/kinnex/' || parsed.pathname.startsWith('/kinnex/')) return uri;
    return '';
  }
  if (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
  ) {
    return uri;
  }
  return '';
}
