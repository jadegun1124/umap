import { Capacitor, registerPlugin } from '@capacitor/core';
import { deliverInviteShare, inviteShareMessage } from '../lib/inviteShare.mjs';

interface InviteSharePlugin {
  inviteShareStatus(): Promise<{ kakaoInstalled?: boolean; kakaoShareReady?: boolean }>;
  shareInvite(options: { url: string; mode: string; text: string }): Promise<{ ok?: boolean }>;
}

const nativeAuth = registerPlugin<InviteSharePlugin>('UmapAuth');

interface KakaoShareHost {
  Kakao?: {
    isInitialized?: () => boolean;
    Share?: {
      sendDefault?: (payload: {
        objectType: 'text';
        text: string;
        link: { webUrl: string; mobileWebUrl: string };
        buttonTitle: string;
      }) => void;
    };
  };
}

function kakaoJsShareReady(): boolean {
  if (typeof window === 'undefined') return false;
  const kakao = (window as unknown as KakaoShareHost).Kakao;
  return kakao?.isInitialized?.() === true && typeof kakao.Share?.sendDefault === 'function';
}

export async function readInviteShareStatus(): Promise<{ kakaoShareReady: boolean; kakaoInstalled: boolean | null }> {
  if (!Capacitor.isNativePlatform()) {
    return { kakaoShareReady: kakaoJsShareReady(), kakaoInstalled: null };
  }
  const status = await nativeAuth.inviteShareStatus().catch(() => null);
  return {
    kakaoShareReady: status?.kakaoShareReady === true,
    kakaoInstalled: status?.kakaoInstalled === true,
  };
}

async function sendWeb(target: string, url: string): Promise<boolean> {
  if (target === 'kakao-share' && kakaoJsShareReady()) {
    const kakao = (window as unknown as KakaoShareHost).Kakao;
    kakao?.Share?.sendDefault?.({
      objectType: 'text',
      text: '이 링크로 들어오면 가족 구성원이 함께 보입니다.',
      link: { webUrl: url, mobileWebUrl: url },
      buttonTitle: '가족 참여',
    });
    return true;
  }
  if (target !== 'chooser' || typeof navigator === 'undefined' || !navigator.share) return false;
  await navigator.share({ title: 'Kinnex 가족 초대', text: '이 링크로 들어오면 가족 구성원이 함께 보입니다.', url });
  return true;
}

async function sendNative(target: string, url: string): Promise<boolean> {
  const result = await nativeAuth.shareInvite({ url, mode: target, text: inviteShareMessage(url) }).catch(() => null);
  return result?.ok === true;
}

export async function sendFamilyInvite(link: string): Promise<{ ok: boolean; path: string; tried: string[] }> {
  const status = await readInviteShareStatus();
  const sent = await deliverInviteShare(link, {
    ...status,
    send: (target, url) => (Capacitor.isNativePlatform() ? sendNative(target, url) : sendWeb(target, url)),
  });
  return { ok: sent.ok, path: sent.path, tried: sent.tried || [] };
}
