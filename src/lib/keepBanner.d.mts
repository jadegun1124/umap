export const KEEP_HEARTBEAT_FRESH_MS: number;

export const KEEP_BANNER_DISMISS_MS: number;

export const FIX_STALE_STILL_MS: number;

export function serviceAlive(input?: {
  serviceRunning?: boolean;
  heartbeatAt?: number;
  lastFixAt?: number;
  now?: number;
  freshMs?: number;
  fixFreshMs?: number;
}): boolean;

export function keepBanner(input?: {
  native?: boolean;
  onMap?: boolean;
  serviceRunning?: boolean;
  userStopped?: boolean;
  keepAlive?: boolean;
  locationMode?: string;
  batteryUnrestricted?: boolean;
  reason?: string;
  heartbeatAt?: number;
  lastFixAt?: number;
  now?: number;
}): {
  action: 'start' | 'always' | 'battery';
  kind: 'permission' | 'battery' | 'dead';
  title: string;
  text: string;
  primary: string;
  settingsLabel: string;
  settingsAction: 'always' | 'battery' | 'app';
} | null;

export function keepBannerVisible<T extends { kind?: string }>(
  banner: T | null | undefined,
  dismissed: { kind?: string; at?: number } | null | undefined,
  now?: number,
): T | null;

export function keepRestartStatus(phase: string): string;
