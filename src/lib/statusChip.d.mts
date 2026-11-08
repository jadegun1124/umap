export const SAME_PLACE_METERS: number;

export function isSelfMember(member: { id?: string; role?: string } | null | undefined): boolean;

export function groupMembersByPlace<T>(members: T[], meters?: number): T[][];

export function orderStatusMembers<T>(members: T[]): T[];

export function cleanStatusPlace(value: unknown): string;

export function representativePlace<T>(members: T[], placeOf: (member: T) => string): string;

export function batteryText(member: { battery?: number | null } | null | undefined): string;

export function statusPaintKey<T extends { id?: string; lat?: number | null; lng?: number | null; battery?: number | null; place?: string | null; name?: string; role?: string }>(
  members: T[],
  selectedId?: string,
): string;

export function memberDisplayName(member: { id?: string; role?: string; name?: string } | null | undefined): string;

export function groupStatusHtml<T extends { id?: string; role?: string; name?: string; battery?: number | null }>(
  members: T[],
  place: string,
): string;
