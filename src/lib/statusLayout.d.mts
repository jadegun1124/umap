export const ANCHOR_HOLD_M: number;
export const GROUP_LEAVE_M: number;
export const OVERLAP_HOLD_PX: number;
export const PREFERRED_CLEAR_PX: number;

export function holdAnchor(
  previous: { lat?: number; lng?: number } | null | undefined,
  next: { lat?: number; lng?: number } | null | undefined,
  holdMeters?: number,
): { lat: number; lng: number } | null;

export function holdSpread(
  previous: Map<string, { lat: number; lng: number; dx: number; dy: number }> | null | undefined,
  next: Map<string, { lat: number; lng: number; dx: number; dy: number }> | null | undefined,
  holdMeters?: number,
): Map<string, { lat: number; lng: number; dx: number; dy: number }>;

export function stablePlaceGroups<T extends { id?: string; role?: string; lat?: number | null; lng?: number | null }>(
  members: T[],
  previousGroups?: Array<{ key?: string; members?: T[] }> | null,
  joinMeters?: number,
  leaveMeters?: number,
): Array<{
  key: string;
  members: T[];
  ordered: T[];
  anchor: { lat: number; lng: number };
  anchorId: string;
}>;

export function soloChipSize(): { width: number; height: number };
export function groupChipSize(rowCount: number): { width: number; height: number };

export function inflateRect(
  rect: { left: number; right: number; top: number; bottom: number },
  pad: number,
): { left: number; right: number; top: number; bottom: number };

export function overlapDepth(
  a: { left: number; right: number; top: number; bottom: number } | null | undefined,
  b: { left: number; right: number; top: number; bottom: number } | null | undefined,
): number;

export function chipBox(
  kind: string,
  anchor: { x: number; y: number },
  offset: { dx?: number; dy?: number } | null | undefined,
  size: { width?: number; height?: number } | null | undefined,
  pinPx?: number,
): { left: number; right: number; top: number; bottom: number };

export function chooseChipOffset(input?: {
  kind?: string;
  anchor?: { x: number; y: number };
  size?: { width?: number; height?: number };
  obstacles?: Array<{ left: number; right: number; top: number; bottom: number }>;
  occupied?: Array<{ left: number; right: number; top: number; bottom: number }>;
  previous?: { dx?: number; dy?: number } | null;
  preferred?: { dx?: number; dy?: number } | null;
  viewport?: { width?: number; height?: number } | null;
}): { dx: number; dy: number };

export function assignChipOffsets(chips: Array<{
  id: string;
  kind?: string;
  anchor?: { x: number; y: number };
  size?: { width?: number; height?: number };
  obstacles?: Array<{ left: number; right: number; top: number; bottom: number }>;
  previous?: { dx?: number; dy?: number } | null;
  preferred?: { dx?: number; dy?: number } | null;
  viewport?: { width?: number; height?: number } | null;
}>): {
  offsets: Map<string, { dx: number; dy: number }>;
  changed: boolean;
};
