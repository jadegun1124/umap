export const SAME_PLACE_METERS: number;
export const STATUS_LIFT_PX: number;

export function groupPinShiftY(pinPx?: number): number;

export function distanceMeters(
  a: { lat?: number | null; lng?: number | null },
  b: { lat?: number | null; lng?: number | null },
): number;

export function orderStatusMembers<T extends { id?: string; role?: string }>(members: T[]): T[];

export interface StatusGroup<T> {
  key: string;
  members: T[];
  ordered: T[];
  anchor: { lat: number; lng: number };
  anchorId: string;
}

export function groupMembersByPlace<T extends { id?: string; role?: string; lat?: number | null; lng?: number | null }>(
  members: T[],
  meters?: number,
): StatusGroup<T>[];

export function firstPlaceLabel<T>(members: T[], placeOf: (member: T) => string): string;

export function groupStatusLabelHtml(input?: {
  place?: string;
  rows?: Array<{
    id?: string;
    name?: string;
    batteryHtml?: string;
    age?: string;
    dimmed?: boolean;
    selected?: boolean;
  }>;
}): string;

export function statusCalloutHtml(
  labelHtml?: string,
  tailColor?: string,
  offset?: { dx?: number; dy?: number } | null,
): string;
