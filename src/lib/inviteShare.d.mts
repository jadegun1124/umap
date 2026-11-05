export const KAKAO_TALK_PACKAGE: string;
export const INVITE_SHARE_TEXT: string;

export const KAKAO_TEMPLATE_HOSTS: string[];

export function kakaoTemplateAllowed(link: string): boolean;

export function inviteShareTarget(input?: {
  kakaoShareReady?: boolean;
  kakaoInstalled?: boolean | null;
  link?: string;
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
