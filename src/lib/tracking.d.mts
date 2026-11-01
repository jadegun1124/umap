export const STOP_RADIUS_M: number;
export const STOP_MIN_MS: number;
export const STRIDE_M: number;
export const TRAIL_POINT_CAP: number;
export const HISTORY_DAYS: number;
export const VISIT_DAY_CAP: number;
export const MODE_WALK_MAX_KMH: number;
export const MODE_BIKE_MAX_KMH: number;
export const MODE_PLANE_MIN_KMH: number;
export const MODE_PLANE_MIN_DISTANCE_M: number;
export const MODE_PLANE_MIN_DURATION_MS: number;
export const FIX_STALE_MS: number;
export const FIX_PRECISE_ACCURACY_M: number;
export const FIX_APPROXIMATE_ACCURACY_M: number;
export const FIX_MAX_JUMP_MPS: number;
export const FIX_JUMP_WINDOW_MS: number;
export const TRAIL_POOR_ACCURACY_M: number;
export const TRAIL_STAY_SPEED_MPS: number;
export const TRAIL_STILL_CONFIRM_M: number;
export const TRAIL_RIDE_MIN_MPS: number;
export const TRAIL_RIDE_VERTEX_MS: number;
export const TRAIL_RIDE_MIN_STEP_M: number;
export const TRAIL_RIDE_STAY_STEP_M: number;
export const RIDE_STATUS_FRESH_MS: number;
export const WALK_STAY_LABEL_MS: number;
export const RIDE_STAY_LABEL_MS: number;
export const STAY_LABEL_DWELL_MS: number;
export const MOTION_STILL_HOLD_MS: number;

export type TravelMode = 'walk' | 'bike' | 'vehicle' | 'plane';

export interface TrailSample {
  lat: number;
  lng: number;
  at: number;
  speedMps?: number | null;
  accuracyM?: number;
  staying?: boolean;
  stayEnd?: boolean;
}

export type TrailDecision = 'keep' | 'snap' | 'drop';

export interface DayStop {
  lat: number;
  lng: number;
  arrivedAt: number;
  leftAt: number | null;
}

export interface DaySegment {
  departAt: number;
  arriveAt: number;
  durationMs: number;
  distanceM: number;
  speedKmh: number;
  mode: TravelMode;
  steps: number | null;
  stepsEstimated: boolean;
  open: boolean;
}

export interface VisitRecord {
  arrivedAt: number;
  label?: string | null;
}

export interface AcceptedFix {
  lat: number;
  lng: number;
  accuracy: number;
  at: number;
  speedMps: number | null;
}

export function modeLabel(mode: TravelMode | string): string;
export function seoulDayKey(epochMs: number): string;
export function needsDailyWipe(storedDay: string | null | undefined, now: number): boolean;
export function isRideStep(last: TrailSample | null | undefined, point: TrailSample | null | undefined): boolean;
export function isVehicleStep(last: TrailSample | null | undefined, point: TrailSample | null | undefined): boolean;
export function fixShowsRide(points: TrailSample[] | null | undefined, point: TrailSample | null | undefined): boolean;
export function recentRide(points: TrailSample[] | null | undefined, now: number): boolean;
export function lastTravelAt(points: TrailSample[] | null | undefined): number | null;
export function lastTravelWasRide(points: TrailSample[] | null | undefined): boolean;
export function stayLabelDwellMs(points: TrailSample[] | null | undefined): number;
export function liveMotionLabel(input: {
  located: boolean;
  moving: boolean | null | undefined;
  points?: TrailSample[] | null;
  now: number;
  pin?: TrailSample | null;
}): '' | '지금' | '머무름';
export function trailMoveGate(last: TrailSample | null | undefined, point: TrailSample | null | undefined): number;
export function isImpossibleJump(last: TrailSample | null | undefined, point: TrailSample | null | undefined): boolean;
export function trailDecision(last: TrailSample | null | undefined, point: TrailSample | null | undefined): TrailDecision;
export function shouldKeepTrailPoint(last: TrailSample | null | undefined, point: TrailSample): boolean;
export function collapseStayTrail(points: TrailSample[] | null | undefined): TrailSample[];
export function collapseIndoorStayDisplay(points: TrailSample[] | null | undefined): TrailSample[];

export function labelCoordinate(
  points: Array<{ lat: number; lng: number; at?: number; staying?: boolean; stayEnd?: boolean; accuracyM?: number }> | null | undefined,
  fallback: { lat?: number | null; lng?: number | null; accuracyM?: number | null } | null | undefined,
  moving?: boolean | null,
): { lat: number; lng: number } | null;
export function stayLabelPoint(
  points: Array<{ lat: number; lng: number; at?: number; staying?: boolean; stayEnd?: boolean }> | null | undefined,
  fallback: { lat?: number | null; lng?: number | null } | null | undefined,
  moving?: boolean | null,
): { lat: number; lng: number } | null;
export const TRAIL_GAP_M: number;
export const TRAIL_GAP_MS: number;
export function trailSegmentDashed(start: TrailSample | null | undefined, end: TrailSample | null | undefined): boolean;
export function trailDrawParts(points: TrailSample[] | null | undefined): { points: TrailSample[]; dashed: boolean }[];
export function appendLiveTip(parts: { points: TrailSample[]; dashed: boolean }[] | null | undefined, trailEnd: TrailSample | null | undefined): { points: TrailSample[]; dashed: boolean }[];
export function visibleTrail(points: TrailSample[] | null | undefined): TrailSample[];
export function displayCoordinate<T extends TrailSample>(points: TrailSample[] | null | undefined, point: T): T;
export function walkLeavesStay(points: TrailSample[] | null | undefined, point: TrailSample | null | undefined): boolean;
export function hasDirectedWalk(points: TrailSample[] | null | undefined): boolean;
export function settleTrailPoint(
  points: TrailSample[] | null | undefined,
  point: TrailSample,
  now: number,
): { points: TrailSample[]; lat: number | null; lng: number | null; decision: TrailDecision };
export function tracksForSeoulDay(tracks: Record<string, TrailSample[]> | null | undefined, now: number): Record<string, TrailSample[]>;
export function visitsForSeoulDay<T extends VisitRecord>(visits: Record<string, T[]> | null | undefined, now: number): Record<string, T[]>;
export function shiftDayKey(dayKey: string, deltaDays: number): string;
export function oldestHistoryDay(now: number): string;
export function isWithinHistory(epochMs: number, now: number): boolean;
export function historyDayKeys(now: number): string[];
export function historyDayLabel(dayKey: string, now: number): string;
export function seoulDayEndMs(dayKey: string): number;
export function trimMemberPoints(points: TrailSample[] | null | undefined, now: number): TrailSample[];
export function appendHistoryPoint(points: TrailSample[] | null | undefined, point: TrailSample, now: number): TrailSample[];
export function tracksWithinHistory(tracks: Record<string, TrailSample[]> | null | undefined, now: number): Record<string, TrailSample[]>;
export function visitsWithinHistory<T extends VisitRecord>(visits: Record<string, T[]> | null | undefined, now: number): Record<string, T[]>;
export function acceptFix(
  previous: { lat: number; lng: number; at: number } | null | undefined,
  reading: { lat?: number; lng?: number; accuracy?: number; at?: number; speedMps?: number | null } | null | undefined,
  options?: { precise?: boolean; now?: number },
): { ok: true; fix: AcceptedFix } | { ok: false; reason: 'coords' | 'stale' | 'accuracy' | 'jump' };
export function classifyMode(speedKmh: number, distanceM: number, durationMs: number): TravelMode;
export function classifyJourneyMode(
  points: TrailSample[] | null | undefined,
  distanceM: number,
  durationMs: number,
): TravelMode;
export function journeyPathDistance(points: TrailSample[] | null | undefined): number;
export function estimateSteps(distanceM: number): number;
export function formatDurationMs(durationMs: number): string;
export function formatFixAge(at: number, now?: number): string;
export function formatDistanceM(meters: number): string;
export function buildDayRecord(points: TrailSample[] | null | undefined, now: number): { stops: DayStop[]; segments: DaySegment[] };
export function mergeVisitStops<T extends DayStop>(previous: T[] | null | undefined, stops: DayStop[] | null | undefined, now: number): Array<T | DayStop>;

export const WALK_JOURNEY_STAY_MS: number;
export const RIDE_JOURNEY_STAY_MS: number;
export const JOURNEY_STAY_MS: number;
export const JOURNEY_STAY_FRESH_MS: number;
export const JOURNEY_MIN_DISTANCE_M: number;
export const JOURNEY_MIN_DURATION_MS: number;
export const STAY_BOUND_RADIUS_M: number;
export const STAY_SLOW_KMH: number;
export const STAY_SLOW_MS: number;
export function isStayNotJourney(
  points: TrailSample[] | null | undefined,
  durationMs: number,
  distanceM?: number,
): boolean;
export const JOURNEY_POINT_CAP: number;
export const JOURNEY_DAY_CAP: number;

export interface JourneyPlace {
  lat: number;
  lng: number;
  label: string | null;
}

export interface JourneyRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  distanceM: number;
  points: TrailSample[];
  start: JourneyPlace;
  end: JourneyPlace;
  open?: boolean;
  /** Dense-path stationary-cloud verdict. False means the trip was a real walk before compaction. */
  cloud?: boolean;
}

export interface JourneySpot {
  lat: number;
  lng: number;
  label?: string | null;
  radiusM?: number;
}

export function splitClosedJourneys(
  points: TrailSample[] | null | undefined,
  now: number,
): { journeys: JourneyRecord[]; remaining: TrailSample[] };
export function storedTrackAfterArchive(
  points: TrailSample[] | null | undefined,
  now: number,
): { journeys: JourneyRecord[]; points: TrailSample[] };
export function liveTrailPoints(points: TrailSample[] | null | undefined, now: number): TrailSample[];
export function displayLivePoints(points: TrailSample[] | null | undefined, now: number): TrailSample[];
export function liveTrailDrawable(points: TrailSample[] | null | undefined, now?: number): boolean;
export function previewOpenJourney(points: TrailSample[] | null | undefined, now: number): JourneyRecord | null;
export function playbackAnchor(
  points: TrailSample[] | null | undefined,
  ratio: number,
): { lat: number; lng: number; at: number; speedMps: number } | null;
export function formatJourneyWhen(startedAt: number, endedAt: number, now?: number): string;
export function formatJourneyDistance(meters: number): string;
export function labelJourneyPlace<T extends JourneyPlace>(place: T, spots: JourneySpot[] | null | undefined): T;
export function collapseDuplicateJourneys(list: JourneyRecord[] | null | undefined): JourneyRecord[];
export function mergeJourneyLists(existing: JourneyRecord[] | null | undefined, incoming: JourneyRecord[] | null | undefined): JourneyRecord[];
export function trimJourneyList(list: JourneyRecord[] | null | undefined, now: number): JourneyRecord[];
export function journeysWithinHistory(
  journeys: Record<string, JourneyRecord[]> | null | undefined,
  now: number,
): Record<string, JourneyRecord[]>;
