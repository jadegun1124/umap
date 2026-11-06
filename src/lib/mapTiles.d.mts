export const MAP_LAND_COLOR: string;
export const VWORLD_TILE_ORIGIN: string;

export function baseTileLayerOptions(): {
  minZoom: number;
  maxZoom: number;
  maxNativeZoom: number;
  keepBuffer: number;
  updateWhenIdle: boolean;
  updateWhenZooming: boolean;
  updateInterval: number;
};
