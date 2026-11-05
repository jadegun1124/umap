export function missingWrapMemberIds(keys: {
  pubs?: Record<string, string>;
  wraps?: Record<string, unknown>;
  revoked?: string[];
} | null | undefined): string[];

export function placeForFamilyRoster<T extends {
  sharing?: boolean;
  audience?: string;
  memberId?: string;
  lat?: number | null;
  lng?: number | null;
  batteryPct?: number | null;
  charging?: boolean | null;
}>(
  place: T | null | undefined,
  opened: { lat?: number | null; lng?: number | null; accuracyM?: number | null } | null | undefined,
): T | null;

export function rosterUnchanged(
  before: Array<{ id?: string; name?: string; lat?: number | null; lng?: number | null; battery?: number | null; charging?: boolean | null; publisherId?: string; lead?: boolean; photo?: string }> | null | undefined,
  after: Array<{ id?: string; name?: string; lat?: number | null; lng?: number | null; battery?: number | null; charging?: boolean | null; publisherId?: string; lead?: boolean; photo?: string }> | null | undefined,
): boolean;

export function mergeFamilyRoster<T extends {
  id?: string;
  name?: string;
  role?: string;
  publisherId?: string;
  lat?: number | null;
  lng?: number | null;
  battery?: number | null;
  charging?: boolean | null;
  lead?: boolean;
  photo?: string;
}>(
  members: T[] | null | undefined,
  options?: {
    code?: string;
    places?: Array<{
      sharing?: boolean;
      audience?: string;
      memberId?: string;
      name?: string;
      lat?: number | null;
      lng?: number | null;
      accuracyM?: number;
      at?: number;
      batteryPct?: number | null;
      charging?: boolean | null;
    }>;
    profiles?: Array<{ memberId?: string; name?: string; at?: number }>;
    departed?: string[];
    hidden?: string[];
    selfId?: string;
    ownerId?: string;
  },
): { members: T[]; joined: string[] };
