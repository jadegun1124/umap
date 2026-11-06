// Loading policy for the one VWorld base layer. The key and the tile URL
// are built elsewhere and are not part of this module.

export const MAP_LAND_COLOR = '#efe6d6';

/** Public tile host. Preconnect uses this and never a keyed path. */
export const VWORLD_TILE_ORIGIN = 'https://api.vworld.kr';

/**
 * Leaflet's mobile default loads tiles only after the finger lifts
 * (`updateWhenIdle`), so a pan shows the pane color until moveend.
 * keepBuffer holds rows outside the screen so the next pan is already painted.
 * updateInterval throttles in-flight work. maxNativeZoom matches the base
 * matrix through 19; higher zooms scale that level instead of requesting holes.
 */
export function baseTileLayerOptions() {
  return {
    minZoom: 6,
    maxZoom: 19,
    maxNativeZoom: 19,
    keepBuffer: 4,
    updateWhenIdle: false,
    updateWhenZooming: true,
    updateInterval: 80,
  };
}
