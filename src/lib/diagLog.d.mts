export function clearDiag(): void;
export function readDiagEvents(now?: number): Array<Record<string, string | number | boolean>>;
export function noteDiag(event: Record<string, string | number | boolean | null | undefined>): void;
export function readDiagCodes(): Array<{ id: string; at: number }>;
export function rememberDiagCode(id: string, at?: number): Array<{ id: string; at: number }>;
export function packDiagUpload(events: Array<Record<string, string | number | boolean>>, limits?: { rawMax?: number; gzipMax?: number }): Promise<string>;
export function fixChannelSource(channel: string, provider?: string | null, precise?: boolean): string;
export function appInForeground(): boolean;
