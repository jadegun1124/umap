export const KEEP_IDLE_WARNING: string;

export function keepStatus(input?: {
  locationMode?: string;
  batteryUnrestricted?: boolean | null;
  serviceRunning?: boolean;
  exactAlarm?: boolean | null;
  backgroundRestricted?: boolean | null;
  samsung?: boolean;
}): {
  location: 'always' | 'while-using' | 'denied' | 'unknown';
  locationLabel: string;
  battery: 'unrestricted' | 'restricted' | 'unknown';
  batteryLabel: string;
  exactAlarmLabel: string;
  backgroundLabel: string;
  serviceLabel: string;
  idleWarning: string;
  fixes: { action: 'always' | 'battery' | 'exact' | 'background' | 'samsung'; label: string }[];
};
