export function spreadPinPositions(members: Array<{ id: string; lat?: number | null; lng?: number | null }>): Map<string, { lat: number; lng: number; dx: number; dy: number }>;

export function projectCallout(lat: number, lng: number, zoom: number): { x: number; y: number };

export function calloutAnchors(input: { lat: number; lng: number; dx?: number; dy?: number; zoom: number }): {
  origin: { x: number; y: number };
  pin: { x: number; y: number };
  labelTail: { x: number; y: number };
};

export function memberCalloutHtml(input: {
  dx?: number;
  dy?: number;
  dimmed?: boolean;
  tailColor?: string;
  labelHtml?: string;
  faceHtml?: string;
}): string;
