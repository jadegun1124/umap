export const KAKAO_TALK_PACKAGE: string;
export const INVITE_SHARE_TEXT: string;

export function inviteShareTarget(input?: {
  kakaoShareReady?: boolean;
  kakaoInstalled?: boolean | null;
}): 'kakao-share' | 'kakao-intent' | 'chooser';

export function nextInviteShare(target: string): '' | 'kakao-intent' | 'chooser';

export function inviteShareMessage(link: string): string;

export function deliverInviteShare(
  link: string,
  env: {
    kakaoShareReady?: boolean;
    kakaoInstalled?: boolean | null;
    send: (target: string, url: string) => Promise<boolean> | boolean;
  },
): Promise<{ ok: boolean; path: string; tried?: string[] }>;
