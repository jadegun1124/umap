export const HISTORY_SHARE_KID: string;
export const DEVICE_STORAGE: string;
export const FAMILY_KEY_STORAGE: string;
export function readDevice(storage: Storage | null | undefined): { publicKey: string; privateKey: string; contentKey: string } | null;
export function writeDevice(storage: Storage | null | undefined, device: { publicKey: string; privateKey: string; contentKey: string }): void;
export function ensureDevice(storage: Storage | null | undefined): Promise<{ publicKey: string; privateKey: string; contentKey: string }>;
export function familyKeyRecord(storage: Storage | null | undefined, code: string): { kid: string; key: Uint8Array } | null;
export function rememberFamilyKey(storage: Storage | null | undefined, code: string, kid: string, key: Uint8Array): void;
export function contentKeyBytes(device: { contentKey?: string } | null): Uint8Array | null;
export function prepareBackup<T extends object>(snapshot: T, storage: Storage | null | undefined, recoveryCode: string): Promise<T>;
export function openAccountSecrets<T extends object>(account: T, storage: Storage | null | undefined, typedCode?: string): Promise<T & { historyLocked?: boolean; journeys?: unknown[]; visits?: unknown[]; home?: unknown }>;
export function historySharesFor(contentKey: Uint8Array | string, peers: Array<{ memberId?: string; publicKey?: string }>): Promise<Record<string, { epk: string; iv: string; ct: string }>>;
export function syncHistoryDirectory(input: {
  history?: Record<string, Record<string, { epk: string; iv: string; ct: string }>>;
  pubs?: Record<string, string>;
  memberId: string;
  privateKey: string;
  contentKey?: Uint8Array | null;
}): Promise<{ history: Record<string, Record<string, { epk: string; iv: string; ct: string }>>; selfShare: { epk: string; iv: string; ct: string } | null }>;
export function historyShareToSave(
  memberId: string,
  history: Record<string, Record<string, { epk: string; iv: string; ct: string }>> | null | undefined,
  mergedFrom: string,
  selfShare: { epk: string; iv: string; ct: string } | null,
): { epk: string; iv: string; ct: string } | null;
export function rewrapHistoryShares(input: {
  history?: Record<string, Record<string, { epk: string; iv: string; ct: string }>>;
  pubs?: Record<string, string>;
  holderId: string;
  holderPrivate: string;
}): Promise<Record<string, Record<string, { epk: string; iv: string; ct: string }>>>;
