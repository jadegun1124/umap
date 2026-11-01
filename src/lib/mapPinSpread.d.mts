export function spreadPinPositions(members: Array<{ id: string; lat?: number | null; lng?: number | null }>): Map<string, { lat: number; lng: number; dx: number; dy: number }>;
