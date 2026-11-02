export function keepStatus(input?: {
  locationMode?: string;
  batteryUnrestricted?: boolean | null;
  serviceRunning?: boolean;
}): {
  location: 'always' | 'while-using' | 'denied' | 'unknown';
  locationLabel: string;
  battery: 'unrestricted' | 'restricted' | 'unknown';
  batteryLabel: string;
  serviceLabel: string;
  fixes: { action: 'always' | 'battery'; label: string }[];
};
