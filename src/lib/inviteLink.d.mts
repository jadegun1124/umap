export function parseInviteUrl(value: string): { code: string; syncToken: string | null; ticket: string | null } | null;
export function buildGroupInviteLink(origin: string, code: string, ticket: string, syncToken: string): string;
export function syncTokenFromInviteFragment(value: string): string | null;
