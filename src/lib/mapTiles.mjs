// Loading policy for the one VWorld base layer. The key and the tile URL
// are built elsewhere and are not part of this module.

export const MAP_LAND_COLOR = '#efe6d6';

/** Public tile host. Preconnect uses this and never a keyed path. */
export const VWORLD_TILE_ORIGIN = 'https://api.vworld.kr';

/**
 * Tile grid work waits until the finger lifts (`updateWhenIdle`).
 * Updating the grid during a pan was the 1.79 jank: the main thread rebuilt
 * tiles on the same frames as the gesture. keepBuffer retains the ring that
 * is already on screen so a short pan back does not go blank. maxNativeZoom
 * matches the base matrix through 19; higher zooms scale that level.
 */
export function baseTileLayerOptions() {
  return {
    minZoom: 6,
    maxZoom: 19,
    maxNativeZoom: 19,
    keepBuffer: 2,
    updateWhenIdle: true,
    updateWhenZooming: true,
    updateInterval: 200,
  };
}
