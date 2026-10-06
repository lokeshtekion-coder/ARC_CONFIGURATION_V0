const STORAGE_KEY = "arc_tekion_token";
export function saveToken(t) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
}
export function loadToken() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export function clearToken() {
    localStorage.removeItem(STORAGE_KEY);
}
export function isTokenExpired(t) {
    return new Date(t.expiresAt) < new Date();
}
export function maskToken(token) {
    if (token.length <= 12)
        return "••••••••";
    return token.slice(0, 6) + "••••••••••••" + token.slice(-6);
}
