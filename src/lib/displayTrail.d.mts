export const PREVIEW_TRAIL_CAP: number;
export const DISPLAY_TRAIL_CAP: number;

export function displaySolidTrail<T extends { lat: number; lng: number }>(
  points: readonly T[] | null | undefined,
  maxVertices?: number,
): T[];

export function trailGeometryKey(
  trails: readonly (readonly { lat: number; lng: number }[] | null | undefined)[] | null | undefined,
): string;
