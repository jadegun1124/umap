export const PUBLISH_JOURNEY_CAP: number;

export function mergeRecordsById(existing: unknown, incoming: unknown): any[];
export function mergeJourneys(existing: unknown, incoming: unknown): any[];
export function journeysToPublish(list: unknown, cap?: number): any[];
export function applyMemberTrail(
  local: { at?: number; points?: unknown[]; journeys?: unknown[]; moving?: boolean } | null,
  incoming: { at?: number; points?: unknown[]; journeys?: unknown[]; moving?: boolean } | null,
): { at: number; points: any[]; journeys: any[]; moving: boolean; changed: boolean };
export function planAccountBackup(input: {
  localJourneys?: unknown;
  localVisits?: unknown;
  remoteOk?: boolean;
  remoteLocked?: boolean;
  remoteJourneys?: unknown;
  remoteVisits?: unknown;
  seenSeal?: string;
}): { keepHistory: boolean; journeys: any[]; visits: any[]; seenSeal: string };
export function shouldApplyTrailResponse(status: number, trails: unknown): boolean;
