// Map paint actions queued while a finger is down. One flush applies them.
// Logout, notices, and navigation are not queued.

const MAP_HOLD_ACTIONS = new Set([
  'update-self',
  'set-battery',
  'set-motion',
  'set-room-family-places',
  'apply-shared-place',
  'apply-shared-profiles',
  'apply-canonical-trails',
  'set-member-place',
  'set-self-place',
  'merge-visits',
  'set-visit-label',
  'set-journey-label',
  'close-journeys',
  'roll-day',
]);

export function isMapHoldAction(type) {
  return MAP_HOLD_ACTIONS.has(type);
}

/** Returns true when the action was queued. */
export function queueMapAction(holding, queue, action) {
  if (!holding || !action || !isMapHoldAction(action.type)) return false;
  queue.push(action);
  return true;
}

/** Drops nested batches. The caller clears the queue. */
export function heldMapActions(queue) {
  const actions = queue.splice(0, queue.length);
  return actions.filter((action) => action && action.type !== 'batch' && isMapHoldAction(action.type));
}
