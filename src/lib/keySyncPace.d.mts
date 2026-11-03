export const FAMILY_KEY_SYNC_MS: number;
export const QUOTA_RETRY_MS: number;
export function shouldRefreshFamilyKeys(lastAt: number | undefined, now: number, hasKey: boolean): boolean;
