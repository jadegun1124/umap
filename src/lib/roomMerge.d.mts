export interface FamilyRoomRef {
  code: string;
  ownerId: string;
  at: number;
  own: boolean;
}

export function listFamilyRooms(input: {
  selfId?: string;
  inviteCode?: string;
  guardians?: Array<{ id?: string; code?: string; ownerMemberId?: string }> | null;
}): FamilyRoomRef[];

export function chooseCanonicalRoom(
  selfId: string,
  rooms: FamilyRoomRef[],
  members?: Array<{ id?: string; role?: string; inviteCode?: string }> | null,
): FamilyRoomRef | null;

export function mergeRoster<T extends {
  id?: string;
  publisherId?: string;
  lat?: number | null;
  lng?: number | null;
  battery?: number | null;
  charging?: boolean | null;
  updatedAt?: number;
  inviteCode?: string;
  lead?: boolean;
  photo?: string;
}>(
  members: T[] | null | undefined,
  canonicalCode: string,
): { members: T[]; moves: Array<{ from: string; to: string }> };

export function planFamilyRoomMerge<T extends { id?: string }, G extends { code?: string }>(input: {
  selfId?: string;
  inviteCode?: string;
  guardians?: G[] | null;
  members?: T[] | null;
}): {
  needed: boolean;
  rooms: FamilyRoomRef[];
  canonical: FamilyRoomRef | null;
  members: T[];
  moves: Array<{ from: string; to: string }>;
  guardians: G[];
  droppedCodes: string[];
};

export function mergePointTrails<T extends Record<string, unknown>>(records: T, from: string, to: string): T;

export function mergeRecordLists<T extends Record<string, unknown>>(records: T, from: string, to: string): T;

export function syncRooms<G extends { code?: string }>(input: {
  inviteCode?: string;
  guardians?: G[] | null;
  familyRoomCode?: string;
}): { includeOwn: boolean; guardians: G[]; codes: string[] };

export function extraRoomDecision(familyRoomCode: string, code: string): 'allow' | 'same' | 'refuse';

export function inviteMintTarget(input: {
  inviteCode?: string;
  familyRoomCode?: string;
}): { code: string; canMint: boolean };

export function canonicalWrapMembers(
  selfId: string,
  members: Array<{ id?: string; role?: string; publisherId?: string }> | null | undefined,
  keys: {
    pubs?: Record<string, string>;
    wraps?: Record<string, unknown>;
    revoked?: string[];
  } | null | undefined,
): string[];
