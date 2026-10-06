// src/services/authHelper.ts
import { loadTekionApiSettings } from "./tekionApiSettings";
import { loadLatestExtensionCapture } from "./extensionBridge";
export const ADMIN_EMAIL = "tlreddy@tekion.com";
function decodeEmailFromJwt(token) {
    if (!token)
        return null;
    const parts = token.trim().split(".");
    if (parts.length !== 3)
        return null;
    try {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
        const payload = JSON.parse(atob(padded));
        const candidate = payload.unique_name ||
            payload.upn ||
            payload.email ||
            payload.preferred_username;
        return typeof candidate === "string" ? candidate.trim().toLowerCase() : null;
    }
    catch {
        return null;
    }
}
/**
 * Checks if the currently active user is tlreddy@tekion.com
 */
export function getCurrentUserEmail() {
    // 1. Check Graph API token
    const settings = loadTekionApiSettings();
    const emailFromGraph = decodeEmailFromJwt(settings.graphApiToken);
    if (emailFromGraph)
        return emailFromGraph;
    // 2. Check Extension captured custom API / TOC tokens
    try {
        const capture = loadLatestExtensionCapture();
        if (capture?.customCaptures) {
            for (const item of Object.values(capture.customCaptures)) {
                if (item.decodedToken?.email) {
                    return item.decodedToken.email.trim().toLowerCase();
                }
                if (item.headers?.authorization) {
                    const email = decodeEmailFromJwt(item.headers.authorization.replace(/^Bearer\s+/i, ""));
                    if (email)
                        return email;
                }
            }
        }
    }
    catch { }
    return "";
}
export function isUserAdmin() {
    const currentEmail = getCurrentUserEmail();
    return currentEmail === ADMIN_EMAIL.toLowerCase();
}
