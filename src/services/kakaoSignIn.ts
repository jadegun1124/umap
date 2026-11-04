import { Capacitor, registerPlugin } from '@capacitor/core';
import { KAKAO_CANCEL_MESSAGE, KAKAO_NATIVE_FAILED_MESSAGE, KAKAO_SERVER_MISSING_MESSAGE, KAKAO_SERVER_UNREACHABLE_MESSAGE, KAKAO_SETUP_MESSAGE, KAKAO_VERIFY_MESSAGE, kakaoJavascriptKey, kakaoNativeAppKeyOrPublic } from '../lib/kakaoAuth.mjs';
import { localProfile } from '../lib/localProfile.mjs';
import { restoredProfile } from '../lib/accountRestore.mjs';
import { ACCOUNT_UNLINKED_MESSAGE } from '../lib/accountRestore.mjs';
import { familySyncUrl } from './familySync';
import { linkKakaoAccount, persistAccountResult, type AccountSnapshot } from './familyAccount';

interface NativeKakaoSignIn {
  signInKakao(options: { nativeAppKey: string }): Promise<{ ok: boolean; accessToken?: string; code?: string; detail?: string }>;
}

const nativeAuth = registerPlugin<NativeKakaoSignIn>('UmapAuth');

export interface ProviderSignInResult {
  ok: boolean;
  profile?: { id: string; name: string; profileKey?: string; photo?: string };
  snapshot?: AccountSnapshot;
  restored?: boolean;
  created?: boolean;
  message?: string;
  detail?: string;
  conflict?: boolean;
  accessToken?: string;
}

export function configuredKakaoNativeAppKey() {
  return kakaoNativeAppKeyOrPublic(import.meta.env.VITE_KAKAO_NATIVE_APP_KEY);
}

export function configuredKakaoJavascriptKey() {
  return kakaoJavascriptKey(import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY);
}

export function configuredKakaoLoginKey() {
  return Capacitor.isNativePlatform() ? configuredKakaoNativeAppKey() : configuredKakaoJavascriptKey();
}

function profileFromAccount(account: AccountSnapshot) {
  return restoredProfile(account) || localProfile(account.profile?.name || '가족', account.memberId);
}

interface KakaoHost {
  Kakao?: {
    isInitialized?: () => boolean;
    init: (key: string) => void;
    Auth?: {
      login: (options: {
        success: (auth: { access_token?: string }) => void;
        fail: (error: { error_description?: string }) => void;
      }) => void;
    };
  };
}

function kakaoWindow() {
  return window as unknown as KakaoHost;
}

function loadKakaoScript() {
  const existing = document.querySelector('script[data-umap-kakao="1"]');
  if (existing && kakaoWindow().Kakao) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js';
    script.async = true;
    script.dataset.umapKakao = '1';
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('kakao-sdk'));
    document.head.appendChild(script);
  });
}

async function browserAccessToken(appKey: string): Promise<string> {
  await loadKakaoScript();
  const sdk = kakaoWindow().Kakao;
  if (!sdk?.Auth?.login) throw new Error('kakao-sdk');
  if (!sdk.isInitialized?.()) sdk.init(appKey);
  return new Promise<string>((resolve, reject) => {
    sdk.Auth?.login({
      success: (auth) => {
        if (auth?.access_token) resolve(auth.access_token);
        else reject(new Error('token'));
      },
      fail: (error) => {
        const text = error?.error_description || '';
        reject(new Error(text.includes('cancel') ? 'canceled' : 'token'));
      },
    });
  });
}

export async function signInWithKakao(
  snapshot?: AccountSnapshot | null,
  options: { persist?: boolean; mode?: 'login' | 'link'; merge?: boolean } = {},
): Promise<ProviderSignInResult> {
  const appKey = configuredKakaoLoginKey();
  if (!appKey) return { ok: false, message: KAKAO_SETUP_MESSAGE };
  if (!familySyncUrl()) return { ok: false, message: KAKAO_SERVER_MISSING_MESSAGE };
  let accessToken = '';
  if (Capacitor.isNativePlatform()) {
    const result: { ok: boolean; accessToken?: string; code?: string; detail?: string } = await nativeAuth.signInKakao({ nativeAppKey: configuredKakaoNativeAppKey() }).catch(() => ({ ok: false, code: 'failed', detail: '' }));
    if (!result.ok || !result.accessToken) {
      if (result.code === 'missing-client') return { ok: false, message: KAKAO_SETUP_MESSAGE };
      if (result.code === 'canceled') return { ok: false, message: KAKAO_CANCEL_MESSAGE };
      if (!result.accessToken) return { ok: false, message: KAKAO_NATIVE_FAILED_MESSAGE, detail: result.detail || undefined };
      return { ok: false, message: KAKAO_VERIFY_MESSAGE, detail: result.detail || undefined };
    }
    accessToken = result.accessToken;
  } else {
    try {
      accessToken = await browserAccessToken(appKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'canceled') return { ok: false, message: KAKAO_CANCEL_MESSAGE };
      if (message === 'kakao-sdk') return { ok: false, message: KAKAO_NATIVE_FAILED_MESSAGE };
      return { ok: false, message: KAKAO_VERIFY_MESSAGE };
    }
  }
  const linked = await linkKakaoAccount(accessToken, snapshot, options.mode || 'login', options.merge === true).catch(() => ({ ok: false as const, message: KAKAO_SERVER_UNREACHABLE_MESSAGE, detail: undefined as string | undefined, conflict: false }));
  if (!linked.ok || !linked.account) {
    return {
      ok: false,
      message: linked.message || KAKAO_VERIFY_MESSAGE,
      detail: linked.detail,
      conflict: linked.conflict === true,
      ...(linked.conflict === true ? { accessToken } : {}),
    };
  }
  if (options.mode === 'link' && linked.account.kakaoLinked !== true) {
    return { ok: false, message: ACCOUNT_UNLINKED_MESSAGE };
  }
  if (options.persist !== false) await persistAccountResult(linked);
  const profile = profileFromAccount(linked.account);
  if (!profile) return { ok: false, message: KAKAO_VERIFY_MESSAGE };
  return { ok: true, profile, snapshot: linked.account, restored: linked.restored === true, created: linked.created === true };
}
