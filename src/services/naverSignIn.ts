import { Capacitor, registerPlugin } from '@capacitor/core';
import { NAVER_APP_REDIRECT, NAVER_CANCEL_MESSAGE, NAVER_NATIVE_FAILED_MESSAGE, NAVER_SERVER_MISSING_MESSAGE, NAVER_SERVER_UNREACHABLE_MESSAGE, NAVER_SETUP_MESSAGE, NAVER_VERIFY_MESSAGE, naverClientIdOrPublic, naverRedirectUri } from '../lib/naverAuth.mjs';
import { localProfile } from '../lib/localProfile.mjs';
import { restoredProfile } from '../lib/accountRestore.mjs';
import { ACCOUNT_UNLINKED_MESSAGE } from '../lib/accountRestore.mjs';
import { familySyncUrl } from './familySync';
import { linkNaverAccount, persistAccountResult, type AccountSnapshot } from './familyAccount';

interface NativeNaverSignIn {
  signInNaver(options: { clientId: string; redirectUri: string }): Promise<{
    ok: boolean;
    code?: string;
    state?: string;
    accessToken?: string;
    error?: string;
  }>;
}

const nativeAuth = registerPlugin<NativeNaverSignIn>('UmapAuth');

export interface ProviderSignInResult {
  ok: boolean;
  profile?: { id: string; name: string; profileKey?: string; photo?: string };
  snapshot?: AccountSnapshot;
  restored?: boolean;
  created?: boolean;
  message?: string;
}

export function configuredNaverClientId() {
  return naverClientIdOrPublic(import.meta.env.VITE_NAVER_CLIENT_ID);
}

function profileFromAccount(account: AccountSnapshot) {
  return restoredProfile(account) || localProfile(account.profile?.name || '가족', account.memberId);
}

function randomState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function authorizeUrl(clientId: string, redirectUri: string, state: string) {
  const url = new URL('https://nid.naver.com/oauth2.0/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

function takeOpenerCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code') || '';
  const state = params.get('state') || '';
  if (!code || !state || !window.opener) return;
  window.opener.postMessage({ umapNaver: { code, state } }, window.location.origin);
  window.close();
}

if (typeof window !== 'undefined') takeOpenerCallback();

async function browserAuthCode(clientId: string): Promise<{ code: string; state: string }> {
  const redirectUri = naverRedirectUri();
  const state = randomState();
  const popup = window.open(authorizeUrl(clientId, redirectUri, state), 'umap-naver', 'width=480,height=720');
  if (!popup) throw new Error('canceled');
  return new Promise((resolve, reject) => {
    const timer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(timer);
        window.removeEventListener('message', onMessage);
        reject(new Error('canceled'));
      }
    }, 400);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const payload = event.data && event.data.umapNaver;
      if (!payload || typeof payload.code !== 'string' || payload.state !== state) return;
      window.clearInterval(timer);
      window.removeEventListener('message', onMessage);
      popup.close();
      resolve({ code: payload.code, state });
    };
    window.addEventListener('message', onMessage);
  });
}

export async function signInWithNaver(
  snapshot?: AccountSnapshot | null,
  options: { persist?: boolean; mode?: 'login' | 'link' } = {},
): Promise<ProviderSignInResult> {
  const clientId = configuredNaverClientId();
  if (!clientId) return { ok: false, message: NAVER_SETUP_MESSAGE };
  if (!familySyncUrl()) return { ok: false, message: NAVER_SERVER_MISSING_MESSAGE };
  let code = '';
  let state = '';
  let accessToken = '';
  let redirectUri = NAVER_APP_REDIRECT;
  if (Capacitor.isNativePlatform()) {
    const result = await nativeAuth.signInNaver({ clientId, redirectUri }).catch(() => ({ ok: false as const, error: 'failed' }));
    if (!result.ok) {
      if (result.error === 'missing-client') return { ok: false, message: NAVER_SETUP_MESSAGE };
      if (result.error === 'canceled') return { ok: false, message: NAVER_CANCEL_MESSAGE };
      return { ok: false, message: NAVER_NATIVE_FAILED_MESSAGE };
    }
    code = result.code || '';
    state = result.state || '';
    accessToken = result.accessToken || '';
    if (!code && !accessToken) return { ok: false, message: NAVER_VERIFY_MESSAGE };
  } else {
    redirectUri = naverRedirectUri();
    try {
      const granted = await browserAuthCode(clientId);
      code = granted.code;
      state = granted.state;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'canceled') return { ok: false, message: NAVER_CANCEL_MESSAGE };
      return { ok: false, message: NAVER_NATIVE_FAILED_MESSAGE };
    }
  }
  const linked = await linkNaverAccount({ accessToken, code, state, redirectUri }, snapshot, options.mode || 'login').catch(() => ({
    ok: false as const,
    message: NAVER_SERVER_UNREACHABLE_MESSAGE,
  }));
  if (!linked.ok || !linked.account) return { ok: false, message: linked.message || NAVER_VERIFY_MESSAGE };
  if (options.mode === 'link' && linked.account.naverLinked !== true) {
    return { ok: false, message: ACCOUNT_UNLINKED_MESSAGE };
  }
  if (options.persist !== false) await persistAccountResult(linked);
  const profile = profileFromAccount(linked.account);
  if (!profile) return { ok: false, message: NAVER_VERIFY_MESSAGE };
  return { ok: true, profile, snapshot: linked.account, restored: linked.restored === true, created: linked.created === true };
}
