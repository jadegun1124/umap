export const FAMILY_KEY_SYNC_MS: number;
export const QUOTA_RETRY_MS: number;
export function shouldRefreshFamilyKeys(lastAt: number | undefined, now: number, hasKey: boolean): boolean;
export function syncPhaseAfterResponse(phase: string, input: {
  ok?: boolean;
  error?: string;
  status?: number;
  method?: string;
  now: number;
  limitedUntil?: number;
}): { phase: string; limitedUntil: number };
