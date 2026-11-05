export const SYNC_BACKOFF_STEPS_MS: number[];
export const SYNC_BACKOFF_CAP_MS: number;

export function syncBackoffDelayMs(attempt: number, random?: number): number;
export function syncFailureKind(status: number | null | undefined): 'server' | 'network' | '';
export function foldSyncOutcome(current: string, next: string): string;
export function applySyncOutcome(
  state: { attempt?: number; until?: number } | null | undefined,
  outcome: string,
  now: number,
  random?: number,
): { attempt: number; until: number };
export function retryDelayMs(
  normalMs: number,
  backoff: { until?: number } | null | undefined,
  now: number,
): number;
