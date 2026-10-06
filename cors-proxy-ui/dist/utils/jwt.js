function base64UrlDecode(input) {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return atob(padded);
}
function tryParseJson(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function toIsoFromEpochSeconds(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return undefined;
    return new Date(value * 1000).toISOString();
}
export function decodeJwt(token) {
    try {
        const trimmed = token.trim();
        const parts = trimmed.split(".");
        if (parts.length < 2) {
            return {
                header: null,
                payload: null,
                signature: null,
                error: "Not a valid JWT",
            };
        }
        const headerRaw = base64UrlDecode(parts[0]);
        const payloadRaw = base64UrlDecode(parts[1]);
        const headerJson = tryParseJson(headerRaw);
        const payloadJson = tryParseJson(payloadRaw);
        const exp = payloadJson && typeof payloadJson.exp === "number"
            ? payloadJson.exp
            : undefined;
        const iat = payloadJson && typeof payloadJson.iat === "number"
            ? payloadJson.iat
            : undefined;
        return {
            header: {
                raw: headerRaw,
                json: headerJson,
            },
            payload: {
                raw: payloadRaw,
                json: payloadJson,
            },
            signature: parts[2] ?? null,
            issuedAt: toIsoFromEpochSeconds(iat),
            expiresAt: toIsoFromEpochSeconds(exp),
            isExpired: typeof exp === "number" ? Date.now() >= exp * 1000 : undefined,
        };
    }
    catch (error) {
        return {
            header: null,
            payload: null,
            signature: null,
            error: error instanceof Error ? error.message : "Failed to decode JWT",
        };
    }
}
