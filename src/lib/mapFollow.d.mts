export const FOLLOW_MOVE_M: number;
export const FOLLOW_GAP_MS: number;

export interface MapFollowState {
  following: boolean;
  targetId: string;
  lastLat: number | null;
  lastLng: number | null;
  lastPanAt: number;
}

export function followTargetId(selectedId: string | null | undefined, selfId?: string): string;
export function createMapFollow(targetId?: string): MapFollowState;
export function noteFollowTarget(state: MapFollowState, targetId: string): MapFollowState;
export function noteUserDrag(state: MapFollowState): MapFollowState;
export function noteRecenter(state: MapFollowState): MapFollowState;
export function planFollowPan(state: MapFollowState, input: {
  now: number;
  foreground: boolean;
  mapVisible: boolean;
  dragging?: boolean;
  memberId: string;
  lat: number;
  lng: number;
}): { state: MapFollowState; pan: { lat: number; lng: number } | null };
export function recenterLabel(targetId: string, name?: string | null, selfId?: string): string;
