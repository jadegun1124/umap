export function clearDiag(): void;
export function readDiagEvents(now?: number): Array<Record<string, string | number | boolean>>;
export function noteDiag(event: Record<string, string | number | boolean | null | undefined>): void;
export function fixChannelSource(channel: string, provider?: string | null, precise?: boolean): string;
export function appInForeground(): boolean;
