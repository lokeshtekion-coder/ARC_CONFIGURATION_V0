// ─────────────────────────────────────────────────────────────
//  tekionAuth.ts  —  Tekion token  (localStorage persistence)
// ─────────────────────────────────────────────────────────────
///Users/tlreddy/Desktop/ARC_CONFIGURATION_V0/cors-proxy-ui/src/services/tekionAuth.ts
export interface TekionToken {
  token:     string;
  expiresAt: string;
  fetchedAt: string;
}

const STORAGE_KEY = "arc_tekion_token";

export function saveToken(t: TekionToken): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
}

export function loadToken(): TekionToken | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as TekionToken; }
  catch { return null; }
}

export function clearToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function isTokenExpired(t: TekionToken): boolean {
  return new Date(t.expiresAt) < new Date();
}

export function maskToken(token: string): string {
  if (token.length <= 12) return "••••••••";
  return token.slice(0, 6) + "••••••••••••" + token.slice(-6);
}
