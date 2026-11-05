// How a group invite leaves this phone.
// Kakao Share when the SDK is ready, otherwise KakaoTalk's package,
// otherwise the system share sheet. Link copy stays a separate button.

export const KAKAO_TALK_PACKAGE = 'com.kakao.talk';
export const INVITE_SHARE_TEXT = '이 링크로 들어오면 가족 구성원이 함께 보입니다.';

export function inviteShareTarget({ kakaoShareReady = false, kakaoInstalled = null } = {}) {
  if (kakaoInstalled === false) return 'chooser';
  if (kakaoShareReady) return 'kakao-share';
  if (kakaoInstalled === true) return 'kakao-intent';
  return 'chooser';
}

export function nextInviteShare(target) {
  if (target === 'kakao-share') return 'kakao-intent';
  if (target === 'kakao-intent') return 'chooser';
  return '';
}

export function inviteShareMessage(link) {
  const url = String(link || '').trim();
  if (!url) return '';
  return `${INVITE_SHARE_TEXT}\n${url}`;
}

export async function deliverInviteShare(link, env) {
  const url = String(link || '').trim();
  if (!url || !env || typeof env.send !== 'function') return { ok: false, path: '' };
  let target = inviteShareTarget(env);
  const tried = [];
  while (target) {
    tried.push(target);
    let ok = false;
    try {
      ok = await env.send(target, url) === true;
    } catch {
      ok = false;
    }
    if (ok) return { ok: true, path: target, tried };
    target = nextInviteShare(target);
  }
  return { ok: false, path: '', tried };
}
