// Status chips stay on a held anchor and a held pixel offset.
// GPS noise inside the hold does not rebuild the chip. Map pans do not
// recompute this; the marker pane carries the chip, and the next layout
// runs after moveend. Buttons win over the preferred slot only when the
// chip actually covers them.

import { distanceMeters, groupMembersByPlace, orderStatusMembers, SAME_PLACE_METERS, STATUS_LIFT_PX } from './memberStatusGroup.mjs';
import { CALLOUT_BLOCK_PX, CALLOUT_WIDTH_PX, MEMBER_PIN_PX } from './mapPinSpread.mjs';

/** Centroid wobble inside this distance keeps the chip where it was. */
export const ANCHOR_HOLD_M = 8;

/** A pair already sharing a chip stays together until this gap, so a 50m edge does not flicker. */
export const GROUP_LEAVE_M = 62;

/** Overlap thinner than this does not count as a reason to jump slots. */
export const OVERLAP_HOLD_PX = 8;

/** The preferred slot must be clear by this much before a chip leaves its current slot. */
export const PREFERRED_CLEAR_PX = 24;

export function holdAnchor(previous, next, holdMeters = ANCHOR_HOLD_M) {
  const point = finitePoint(next);
  if (!point) return finitePoint(previous);
  const prior = finitePoint(previous);
  if (!prior) return point;
  if (distanceMeters(prior, point) <= holdMeters) return prior;
  return point;
}

/**
 * Real lat/lng always updates. The pixel slot stays until the person has
 * moved past the hold, so a latitude wobble does not swap who is "south".
 */
export function holdSpread(previous, next, holdMeters = ANCHOR_HOLD_M) {
  const prior = previous instanceof Map ? previous : new Map();
  const coming = next instanceof Map ? next : new Map();
  const held = new Map();
  for (const [id, slot] of coming) {
    if (!slot) continue;
    const before = prior.get(id);
    const lat = Number(slot.lat);
    const lng = Number(slot.lng);
    if (!before || distanceMeters(before, slot) > holdMeters) {
      held.set(id, { lat, lng, dx: Number(slot.dx) || 0, dy: Number(slot.dy) || 0 });
      continue;
    }
    held.set(id, { lat, lng, dx: Number(before.dx) || 0, dy: Number(before.dy) || 0 });
  }
  return held;
}

/**
 * Same groups as groupMembersByPlace when there is no history.
 * A pair that already shared a chip stays merged until GROUP_LEAVE_M.
 */
export function stablePlaceGroups(members, previousGroups, joinMeters = SAME_PLACE_METERS, leaveMeters = GROUP_LEAVE_M) {
  const history = previousIds(previousGroups);
  if (history.size === 0) return groupMembersByPlace(members, joinMeters);
  const located = locatedMembers(members);
  const limit = Number(joinMeters);
  const leave = Number(leaveMeters);
  const parent = located.map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    let walk = index;
    while (parent[walk] !== walk) {
      const next = parent[walk];
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  const unite = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };
  for (let i = 0; i < located.length; i += 1) {
    for (let j = i + 1; j < located.length; j += 1) {
      const gap = distanceMeters(located[i], located[j]);
      const sticky = Number.isFinite(leave) && gap <= leave && sharedBefore(history, located[i], located[j]);
      if ((Number.isFinite(limit) && limit >= 0 && gap <= limit) || sticky) unite(i, j);
    }
  }
  const buckets = new Map();
  located.forEach((member, index) => {
    const root = find(index);
    const bucket = buckets.get(root);
    if (bucket) bucket.push(member);
    else buckets.set(root, [member]);
  });
  const groups = [];
  for (const bucket of buckets.values()) {
    const ordered = orderStatusMembers(bucket);
    const lat = bucket.reduce((sum, member) => sum + Number(member.lat), 0) / bucket.length;
    const lng = bucket.reduce((sum, member) => sum + Number(member.lng), 0) / bucket.length;
    let anchor = ordered[0];
    let best = Infinity;
    for (const member of ordered) {
      const gap = distanceMeters({ lat, lng }, member);
      if (gap < best - 1e-6) {
        best = gap;
        anchor = member;
      }
    }
    const key = bucket.map((member) => String(member.id ?? '')).sort((a, b) => a.localeCompare(b)).join('|');
    groups.push({
      key,
      members: bucket,
      ordered,
      anchor: { lat, lng },
      anchorId: String(anchor?.id ?? ''),
    });
  }
  return groups;
}

/**
 * Keep the chip on a pin that is still in the group.
 * `previousHosts` maps each member id to the pin that carried the chip.
 * A new member does not steal the chip. The old host wins by votes.
 * A tie keeps `self` when that pin is one of the hosts, otherwise the
 * lexicographic id. If every old host has left, `fallbackId` is used.
 */
export function stickyStatusHost(memberIds, previousHosts, fallbackId) {
  const ids = (Array.isArray(memberIds) ? memberIds : []).map((id) => String(id ?? '')).filter(Boolean);
  const present = new Set(ids);
  const votes = new Map();
  const history = previousHosts instanceof Map ? previousHosts : new Map();
  for (const id of ids) {
    const prior = history.get(id);
    const host = prior == null ? '' : String(prior);
    if (!host || !present.has(host)) continue;
    votes.set(host, (votes.get(host) || 0) + 1);
  }
  if (votes.size === 0) return String(fallbackId ?? ids[0] ?? '');
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ranked[0][1];
  const tied = ranked.filter((entry) => entry[1] === top).map((entry) => entry[0]);
  if (tied.includes('self')) return 'self';
  return tied[0];
}

export function soloChipSize() {
  return { width: CALLOUT_WIDTH_PX, height: CALLOUT_BLOCK_PX };
}

export function groupChipSize(rowCount) {
  const rows = Math.max(1, Number(rowCount) || 1);
  return { width: 200, height: 40 + rows * 36 };
}

export function inflateRect(rect, pad) {
  const extra = Number(pad) || 0;
  return {
    left: rect.left - extra,
    right: rect.right + extra,
    top: rect.top - extra,
    bottom: rect.bottom + extra,
  };
}

/** Positive means the rectangles cross. The value is the thinner overlap. */
export function overlapDepth(a, b) {
  if (!a || !b) return 0;
  const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (x <= 0 || y <= 0) return 0;
  return Math.min(x, y);
}

/**
 * Screen box of a chip. `pin` anchors are circle centers and the callout
 * already sits on the top edge before dx/dy. `status` anchors are the
 * lat/lng the leader starts from, and dy is the CSS translate (+y down).
 */
export function chipBox(kind, anchor, offset, size, pinPx = MEMBER_PIN_PX) {
  const dx = Number(offset?.dx) || 0;
  const dy = Number(offset?.dy) || 0;
  const tailX = Number(anchor?.x) + dx;
  const tailY = kind === 'pin' ? Number(anchor?.y) - pinPx / 2 + dy : Number(anchor?.y) + dy;
  const width = Math.max(1, Number(size?.width) || 1);
  const height = Math.max(1, Number(size?.height) || 1);
  return {
    left: tailX - width / 2,
    right: tailX + width / 2,
    top: tailY - height,
    bottom: tailY,
  };
}

function slotPressure(box, obstacles, occupied) {
  let hit = 0;
  for (const obstacle of obstacles || []) hit += overlapDepth(box, obstacle);
  for (const other of occupied || []) hit += overlapDepth(box, other);
  return hit;
}

function sameOffset(a, b) {
  return !!a && !!b && Number(a.dx) === Number(b.dx) && Number(a.dy) === Number(b.dy);
}

/**
 * Keep the previous slot until it covers a button or another chip.
 * Return to the preferred slot only when that slot is clearly free.
 */
export function chooseChipOffset({
  kind = 'status',
  anchor,
  size,
  obstacles = [],
  occupied = [],
  previous = null,
  preferred = null,
  viewport = null,
} = {}) {
  const prefer = preferred || (kind === 'pin' ? { dx: 0, dy: 0 } : { dx: 0, dy: -STATUS_LIFT_PX });
  const around = kind === 'pin'
    ? [
      prefer,
      { dx: 0, dy: 0 },
      { dx: 0, dy: -80 },
      { dx: -140, dy: -16 },
      { dx: 140, dy: -16 },
      { dx: -160, dy: 28 },
      { dx: 160, dy: 28 },
      { dx: 0, dy: 52 },
    ]
    : [
      prefer,
      { dx: 0, dy: -STATUS_LIFT_PX },
      { dx: 0, dy: -150 },
      { dx: -160, dy: -72 },
      { dx: 160, dy: -72 },
      { dx: -180, dy: -12 },
      { dx: 180, dy: -12 },
      { dx: 0, dy: 36 },
    ];
  const hit = (offset) => slotPressure(chipBox(kind, anchor, offset, size), obstacles, occupied);
  const onScreen = (offset) => {
    if (!viewport || !Number.isFinite(Number(viewport.width)) || !Number.isFinite(Number(viewport.height))) return true;
    const box = chipBox(kind, anchor, offset, size);
    return box.left >= 4 && box.top >= 4 && box.right <= Number(viewport.width) - 4 && box.bottom <= Number(viewport.height) - 4;
  };
  const clearlyFree = (offset) => onScreen(offset) && slotPressure(
    inflateRect(chipBox(kind, anchor, offset, size), PREFERRED_CLEAR_PX),
    obstacles,
    occupied,
  ) === 0;
  if (previous && Number.isFinite(Number(previous.dx)) && Number.isFinite(Number(previous.dy)) && onScreen(previous)) {
    const stayed = chipBox(kind, anchor, previous, size);
    // A button overlap of any size leaves the slot. Chip-to-chip overlap
    // under OVERLAP_HOLD_PX does not, so two labels do not trade places.
    const buttonHit = slotPressure(stayed, obstacles, []);
    const chipHit = slotPressure(stayed, [], occupied);
    if (buttonHit === 0 && chipHit <= OVERLAP_HOLD_PX) {
      if (!sameOffset(previous, prefer) && clearlyFree(prefer)) return { dx: Number(prefer.dx) || 0, dy: Number(prefer.dy) || 0 };
      return { dx: Number(previous.dx) || 0, dy: Number(previous.dy) || 0 };
    }
  }
  let best = { dx: Number(prefer.dx) || 0, dy: Number(prefer.dy) || 0 };
  let bestHit = Infinity;
  let bestOnScreen = false;
  const seen = new Set();
  for (const candidate of around) {
    if (!candidate) continue;
    const dx = Number(candidate.dx) || 0;
    const dy = Number(candidate.dy) || 0;
    const key = `${dx},${dy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const value = hit({ dx, dy });
    const visible = onScreen({ dx, dy });
    if (value === 0 && visible) return { dx, dy };
    const better = (visible && !bestOnScreen) || (visible === bestOnScreen && value < bestHit);
    if (better) {
      best = { dx, dy };
      bestHit = value;
      bestOnScreen = visible;
    }
  }
  return best;
}

/** Place chips in order. Earlier chips occupy space so later ones step aside. */
export function assignChipOffsets(chips) {
  const occupied = [];
  const offsets = new Map();
  let changed = false;
  for (const chip of Array.isArray(chips) ? chips : []) {
    if (!chip || chip.id == null || !chip.anchor) continue;
    const next = chooseChipOffset({
      kind: chip.kind,
      anchor: chip.anchor,
      size: chip.size,
      obstacles: chip.obstacles,
      occupied,
      previous: chip.previous,
      preferred: chip.preferred,
      viewport: chip.viewport,
    });
    offsets.set(chip.id, next);
    occupied.push(chipBox(chip.kind, chip.anchor, next, chip.size));
    if (!chip.previous || Number(chip.previous.dx) !== next.dx || Number(chip.previous.dy) !== next.dy) changed = true;
  }
  return { offsets, changed };
}

function finitePoint(value) {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function locatedMembers(members) {
  return (Array.isArray(members) ? members : []).filter((member) => (
    member
    && member.lat != null
    && member.lng != null
    && Number.isFinite(Number(member.lat))
    && Number.isFinite(Number(member.lng))
  ));
}

function previousIds(groups) {
  const history = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    const ids = (group?.members || []).map((member) => String(member?.id ?? '')).filter(Boolean);
    for (const id of ids) history.set(id, ids);
  }
  return history;
}

function sharedBefore(history, left, right) {
  const ids = history.get(String(left?.id ?? ''));
  return Array.isArray(ids) && ids.includes(String(right?.id ?? ''));
}
