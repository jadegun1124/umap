export function familyMapShowsTrail(input: {
  viewingRecords: boolean;
  detailOpen: boolean;
  showTrail: boolean;
  member: { id?: string; share?: string; role?: string } | null | undefined;
  liveDrawable?: boolean;
}): boolean;

export function recordsDayTrails(input: {
  journeys?: { points?: { lat: number; lng: number; at: number }[] }[] | null;
  livePoints?: { lat: number; lng: number; at: number }[] | null;
  liveDrawable?: boolean;
}): { lat: number; lng: number; at: number }[][];

export function screenMapTrails<T extends { lat: number; lng: number; at: number }>(input: {
  viewingRecords: boolean;
  detailOpen: boolean;
  detailPoints?: readonly T[] | null;
  liveLines?: readonly (readonly T[])[] | null;
}): T[][];

export function memberLiveLines(
  member: {
    id?: string;
    role?: string;
    share?: string;
    lat?: number | null;
    lng?: number | null;
    updatedAt?: number;
    accuracyM?: number;
    moving?: boolean | null;
    speedMps?: number | null;
    staying?: boolean;
  } | null | undefined,
  tracks: Record<string, { lat: number; lng: number; at: number; speedMps?: number | null; accuracyM?: number; staying?: boolean; stayEnd?: boolean }[] | undefined> | null | undefined,
  now: number,
  liveDay?: string,
  withPin?: boolean,
): {
  lines: { lat: number; lng: number; at: number }[][];
  reason: string;
  stored: number;
  live: number;
};

export function mainOverviewTrails(input: {
  points?: { lat: number; lng: number; at: number; speedMps?: number | null; accuracyM?: number; staying?: boolean; stayEnd?: boolean }[] | null;
  motionPoints?: { lat: number; lng: number; at: number; speedMps?: number | null; accuracyM?: number; stayEnd?: boolean }[] | null;
  pin?: { lat: number; lng: number; at?: number; speedMps?: number | null; accuracyM?: number; staying?: boolean } | null;
  moving?: boolean | null;
  located?: boolean;
  now?: number;
  withPin?: boolean;
}): { lat: number; lng: number; at: number }[][];
