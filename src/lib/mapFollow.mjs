// Live map camera. Follow the selected person while the map is on screen,
// and stop when the user drags. A short gap and a minimum move keep pans rare.

export const FOLLOW_MOVE_M = 18;
export const FOLLOW_GAP_MS = 1_500;

export function followTargetId(selectedId, selfId = 'self') {
  if (typeof selectedId === 'string' && selectedId && selectedId !== selfId) return selectedId;
  return selfId;
}

export function createMapFollow(targetId = 'self') {
  return { following: true, targetId, lastLat: null, lastLng: null, lastPanAt: 0 };
}

export function noteFollowTarget(state, targetId) {
  if (state.targetId === targetId) return state;
  return { ...state, targetId, following: true, lastLat: null, lastLng: null, lastPanAt: 0 };
}

export function noteUserDrag(state) {
  if (!state.following) return state;
  return { ...state, following: false };
}

export function noteRecenter(state) {
  return { ...state, following: true, lastLat: null, lastLng: null, lastPanAt: 0 };
}

function movedMeters(fromLat, fromLng, lat, lng) {
  const radius = 6_371_000;
  const p1 = (fromLat * Math.PI) / 180;
  const p2 = (lat * Math.PI) / 180;
  const dLat = ((lat - fromLat) * Math.PI) / 180;
  const dLng = ((lng - fromLng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function planFollowPan(state, input) {
  if (!state.following || !input.foreground || !input.mapVisible || input.dragging) return { state, pan: null };
  if (input.memberId !== state.targetId) return { state, pan: null };
  const since = input.now - state.lastPanAt;
  const moved = state.lastLat == null ? Number.POSITIVE_INFINITY : movedMeters(state.lastLat, state.lastLng, input.lat, input.lng);
  if (state.lastLat != null && moved < FOLLOW_MOVE_M && since < FOLLOW_GAP_MS) return { state, pan: null };
  return {
    state: { ...state, lastLat: input.lat, lastLng: input.lng, lastPanAt: input.now },
    pan: { lat: input.lat, lng: input.lng },
  };
}

export function recenterLabel(targetId, name, selfId = 'self') {
  if (!targetId || targetId === selfId) return '내 위치로';
  const who = typeof name === 'string' ? name.trim() : '';
  return who ? `${who} 위치로` : '선택한 위치로';
}
