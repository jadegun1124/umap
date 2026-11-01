export function keepBanner(input?: {
  native?: boolean;
  onMap?: boolean;
  serviceRunning?: boolean;
  userStopped?: boolean;
  keepAlive?: boolean;
  locationMode?: string;
  batteryUnrestricted?: boolean;
}): { action: 'start' | 'always' | 'battery'; text: string } | null;
