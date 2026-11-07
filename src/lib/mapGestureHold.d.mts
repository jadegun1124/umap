export function isMapHoldAction(type: string): boolean;

export function queueMapAction<T extends { type: string }>(
  holding: boolean,
  queue: T[],
  action: T,
): boolean;

export function heldMapActions<T extends { type: string }>(queue: T[]): T[];
