export function isSelfEchoMember(
  member: { role?: string; id?: string; publisherId?: string } | null | undefined,
  profileId?: string,
  inviteCode?: string,
  profileName?: string,
): boolean;

export function isSelfEchoPlace(
  place: { memberId?: string; code?: string; audience?: string } | null | undefined,
  profileId?: string,
  inviteCode?: string,
): boolean;

export function withoutSelfEcho<T>(members: T[] | null | undefined, profileId?: string, inviteCode?: string, profileName?: string): T[];

export function rosterMembers<T extends { role?: string; id?: string }>(members: T[] | null | undefined, profileId?: string, inviteCode?: string, profileName?: string): T[];

export function ensureRoster<T extends { id?: string; publisherId?: string; name?: string; lead?: boolean }>(
  members: T[] | null | undefined,
  profiles: Array<{ memberId?: string; name?: string; at?: number }> | null | undefined,
  code: string,
  ownerId?: string,
  hidden?: string[],
): { members: T[]; joined: string[] };

export function mapMembers<T extends { role?: string; id?: string; lat?: number | null; lng?: number | null; share?: string }>(
  members: T[] | null | undefined,
  profileId?: string,
  inviteCode?: string,
  profileName?: string,
): T[];

export function mergePeerSessions<T extends {
  savedAt?: number;
  stage?: string;
  mode?: string | null;
  profile?: { id?: string; name?: string } | null;
  members?: Array<{ id?: string; role?: string; publisherId?: string; updatedAt?: number }>;
  guardians?: Array<{ code?: string; share?: string }>;
  inviteCode?: string;
  syncWriteKey?: string;
  syncReadKey?: string;
  shareSelfWithFamily?: boolean;
  permissions?: { completed?: boolean };
}>(snapshots: T[]): T | null;
