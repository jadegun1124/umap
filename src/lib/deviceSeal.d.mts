export function deviceSealAvailable(): boolean;
export function sealDeviceText(plain: string): Promise<string>;
export function openDeviceText(sealed: string): Promise<string>;
export function readDurableSession(): Promise<{ ok: boolean; raw: string }>;
export function writeDurableSession(raw: string): Promise<boolean>;
