export interface Profile {
  /** Device-local id. Not a Google subject and not a phone number. */
  id: string;
  name: string;
  /** Square JPEG data URL. Shown here immediately and synced as a thumbnail. */
  photo?: string;
  /** Secret for this device's profile writes. Never sent to other phones. */
  profileKey?: string;
}

export interface TrackPoint {
  lat: number;
  lng: number;
  at: number;
  speedMps?: number | null;
  accuracyM?: number;
  staying?: boolean;
  stayEnd?: boolean;
}

export interface Visit {
  id: string;
  lat: number;
  lng: number;
  label: string | null;
  arrivedAt: number;
  leftAt: number | null;
  source: 'geocode' | 'coords';
}

export interface Journey {
  id: string;
  startedAt: number;
  endedAt: number;
  distanceM: number;
  points: TrackPoint[];
  start: { lat: number; lng: number; label: string | null };
  end: { lat: number; lng: number; label: string | null };
  open?: boolean;
  /** Dense-path stationary-cloud verdict saved at archive time. */
  cloud?: boolean;
}

export type AppMode = 'admin' | 'managed';
export type ShareState = 'invited' | 'accepted' | 'allowed' | 'revoked';

export interface Member {
  id: string;
  name: string;
  role: 'self' | 'child' | 'guardian' | 'admin-share';
  lat: number | null;
  lng: number | null;
  accuracyM: number;
  battery: number | null;
  charging: boolean | null;
  updatedAt: number;
  moving: boolean | null;
  photo?: string;
  /** Publisher's stable member id. Display name can change without moving this row. */
  publisherId?: string;
  place?: string | null;
  /** Where `place` was looked up. A later accurate walk is measured from here. */
  placeLat?: number | null;
  placeLng?: number | null;
  inviteCode?: string;
  share: ShareState;
  /** The other phone still publishes a clear location, so it has not updated to 1.36. */
  needsAppUpdate?: boolean;
}

export interface LeaveAlert {
  label: string;
  lat: number;
  lng: number;
  radiusM: number;
}

export interface GuardianLink {
  id: string;
  label: string;
  code: string;
  share: 'accepted' | 'allowed' | 'revoked';
  leaveAlert: LeaveAlert | null;
  syncToken?: string;
  /** Admin's roster label carried in the invite link. The phone still publishes under this name when set. */
  rosterName?: string;
  /** Admin display name from the invite, used as the other side of a private chat. */
  adminName?: string;
}

export interface HomeZone {
  label: string;
  address: string;
  lat: number;
  lng: number;
  radiusM: number;
  alertPhone: string;
}

export interface FamilyNotice {
  id: string;
  title: string;
  body: string;
  at: number;
  read: boolean;
}

export interface PermissionState {
  notifications: 'unknown' | 'granted' | 'denied' | 'skipped';
  accuracy: 'precise' | 'approximate';
  locationMode: 'unknown' | 'while-using' | 'always' | 'denied';
  motion: 'unknown' | 'granted' | 'denied' | 'skipped';
  battery: 'unknown' | 'acknowledged' | 'skipped';
  completed: boolean;
}

export type Stage = 'splash' | 'login' | 'mode' | 'survey' | 'terms' | 'phone' | 'permissions' | 'map';
export type FamilyTab = 'map' | 'history' | 'menu';

export interface Session {
  stage: Stage;
  profile: Profile | null;
  survey: string | null;
  terms: Record<string, boolean>;
  phone: string;
  phoneVerified: boolean;
  permissions: PermissionState;
  members: Member[];
  tracks: Record<string, TrackPoint[]>;
  trailDay: string;
  visits: Record<string, Visit[]>;
  /** Finished trips. Another phone renders the publisher's copy instead of rebuilding it. */
  journeys: Record<string, Journey[]>;
  /** Publisher id → timestamp of the canonical trail already applied on this phone. */
  trailRevisions: Record<string, number>;
  shareSelfWithFamily: boolean;
  /** False only after the person withdraws 개인위치정보 이용 동의. */
  locationConsent?: boolean;
  /** Past journeys stay sealed until this phone has the recovery code. */
  historyLocked: boolean;
  sealedHistory: unknown;
  accountVault: unknown;
  mergedVault?: unknown;
  backgroundKeepAlive: boolean;
  home: HomeZone | null;
  /** True after the person clears 우리 집, so an empty backup does not mean "no home loaded". */
  homeCleared?: boolean;
  inviteCode: string;
  notices: FamilyNotice[];
  tab: FamilyTab;
  pendingInvite: string | null;
  mode: AppMode | null;
  guardians: GuardianLink[];
  pendingLeaveAlert: LeaveAlert | null;
  syncWriteKey: string;
  syncReadKey: string;
  pendingSyncToken: string | null;
  /** Member ids and publisher ids removed on this phone. Sync does not put them back. */
  hiddenMemberIds: string[];
  /** Family member ids told when this phone starts or stops moving. Empty sends nothing. */
  motionNotifyIds: string[];
  /** Last start/stop phase. unknown adopts the current trip without sending. */
  motionAlertPhase: 'unknown' | 'still' | 'moving';
}

export const DEFAULT_CENTER = { lat: 37.6366, lng: 127.0672 };

export const TERM_IDS = {
  terms: 'terms',
  location: 'location',
  locationUse: 'locationUse',
  privacy: 'privacy',
  guardian: 'guardian',
  marketing: 'marketing',
  overseas: 'overseas',
} as const;

export const REQUIRED_TERMS = [TERM_IDS.terms, TERM_IDS.location, TERM_IDS.locationUse, TERM_IDS.privacy, TERM_IDS.guardian];
