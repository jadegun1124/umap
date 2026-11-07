export const FAMILY_STORAGE_KEY: string;
export const PLAIN_SESSION_KEY: string;
export const DEVICE_SEAL_PREFIX: string;

export function parseStoredSession(raw: string): Record<string, unknown> | null;
export function recordBags(session: unknown): { journeys: number; visits: number; tracks: number };
export function historyScore(session: unknown): number;
export function liveHistoryScore(session: unknown, now?: number): number;
export function shouldRehydrateMerged(mergedScore: number, stateScore: number, lastRehydratedScore: number): boolean;
export function needsHistoryRestore(session: unknown): boolean;
export function mergedSessionRaw(previousRaw: string, nextRaw: string): string;
export function readSeal(storage: { getItem(key: string): string | null } | null): string;
export function collectJsonSnapshots(
  localStorage: { getItem(key: string): string | null } | null,
  sessionStorage: { getItem(key: string): string | null } | null,
): any[];
export function richerStoredRaw(localStorage: { getItem(key: string): string | null } | null, next: unknown): string;
export function writePlainSession(localStorage: { setItem(key: string, value: string): void } | null, raw: string): void;
export function clearPlainSession(localStorage: { removeItem(key: string): void } | null): void;
export function commitDurableSession(
  localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void } | null,
  nextSession: unknown,
  nextRaw: string,
  options?: { sealText?: string | null; unreadSeal?: boolean },
): { wrote: boolean; reason?: string; plain?: string };
export function fillFromAccount(account: unknown): { journeys: unknown[]; visits: unknown[]; home: unknown } | null;
