export const MEMBER_PIN_PX: number;
export const CALLOUT_WIDTH_PX: number;
export const CALLOUT_BLOCK_PX: number;
export const CALLOUT_STACK_PX: number;

export function memberPinIcon(): { iconSize: [number, number]; iconAnchor: [number, number] };

export function bubbleSlot(index: number, count: number): { dx: number; dy: number };

export function spreadPinPositions(members: Array<{ id: string; lat?: number | null; lng?: number | null }>): Map<string, { lat: number; lng: number; dx: number; dy: number }>;

export function markerZIndex(dy?: number, selected?: boolean): number;

export function projectCallout(lat: number, lng: number, zoom: number): { x: number; y: number };

export function calloutAnchors(input: { lat: number; lng: number; dx?: number; dy?: number; zoom: number }): {
  origin: { x: number; y: number };
  pin: { x: number; y: number };
  labelTail: { x: number; y: number };
  pinRim: { x: number; y: number };
  tailTip: { x: number; y: number };
};

export function calloutLeader(dx?: number, dy?: number): {
  needed: boolean;
  from: { x: number; y: number };
  to: { x: number; y: number };
};

export function calloutScreenBox(input: { lat: number; lng: number; dx?: number; dy?: number; zoom: number }): {
  left: number;
  right: number;
  top: number;
  bottom: number;
  pin: { x: number; y: number };
  tail: { x: number; y: number };
};

export function calloutBoxesOverlap(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
): boolean;

export function calloutTransform(dx?: number, dy?: number): string;

export function syncCalloutGeometry(root: ParentNode | null | undefined, dx?: number, dy?: number): void;

export function memberCalloutHtml(input: {
  dx?: number;
  dy?: number;
  dimmed?: boolean;
  tailColor?: string;
  labelHtml?: string;
  faceHtml?: string;
}): string;
