// Kakao Login. The Kakao user id is never the family member id.
// The native app key is public. The JavaScript key stays empty until the web app is registered.

export const PUBLIC_KAKAO_NATIVE_APP_KEY = 'b42233e0170711205fa75bbca06e98e9';

export const KAKAO_SETUP_MESSAGE = [
  '카카오 로그인을 마치지 못했습니다. 이 상태로 시작하지 않습니다.',
  '1. Kakao Developers에서 애플리케이션을 만들고 카카오 로그인을 켭니다.',
  '2. Android 플랫폼 패키지는 kr.co.umap.tracker 이고, 키 해시는 사이드로드 SHA-1입니다.',
  '3. 앱은 VITE_KAKAO_NATIVE_APP_KEY와 KAKAO_NATIVE_APP_KEY, 웹은 VITE_KAKAO_JAVASCRIPT_KEY를 넣고 다시 빌드합니다.',
].join('\n');

export const KAKAO_VERIFY_MESSAGE = '카카오 로그인 토큰이 거절되었습니다. 다시 로그인해 주세요.';
export const KAKAO_CANCEL_MESSAGE = '카카오 로그인을 취소했습니다.';
export const KAKAO_SERVER_MISSING_MESSAGE = '위치 서버 주소가 없어 카카오 로그인을 시작하지 않습니다.';
export const KAKAO_NATIVE_FAILED_MESSAGE = '카카오 로그인 창이 실패했습니다. 다시 시도해 주세요.';
export const KAKAO_SERVER_UNREACHABLE_MESSAGE = '위치 서버에 연결하지 못해 카카오 로그인을 마치지 못했습니다.';

function kakaoAppKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || /your-|placeholder|example|missing/i.test(key)) return '';
  if (!/^[A-Za-z0-9]{16,64}$/.test(key)) return '';
  return key;
}

export function kakaoNativeAppKey(value) {
  return kakaoAppKey(value);
}

export function kakaoNativeAppKeyOrPublic(value) {
  return kakaoAppKey(value) || kakaoAppKey(PUBLIC_KAKAO_NATIVE_APP_KEY);
}

export function kakaoJavascriptKey(value) {
  return kakaoAppKey(value);
}
