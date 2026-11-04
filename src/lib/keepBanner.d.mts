export const KEEP_HEARTBEAT_FRESH_MS: number;

export function serviceAlive(input?: {
  serviceRunning?: boolean;
  heartbeatAt?: number;
  now?: number;
  freshMs?: number;
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
  now?: number;
}): { action: 'start' | 'always' | 'battery'; text: string } | null;
