const LOCAL_URLS = ["http://localhost:5175/*", "http://127.0.0.1:5175/*", "http://localhost:3000/*"];
const STORAGE_KEY = "arcLatestCaptureState";
const CUSTOM_RULES_STORAGE_KEY = "arcCustomWatchedApis";
function mustGet(id) {
    const el = document.getElementById(id);
    if (!el)
        throw new Error(`Missing popup element: ${id}`);
    return el;
}
function getElements() {
    return {
        versionChip: mustGet("versionChip"),
        openAppBtn: mustGet("openAppBtn"),
        refreshBtn: mustGet("refreshBtn"),
        navButtons: Array.from(document.querySelectorAll(".nav-btn")),
        panels: Array.from(document.querySelectorAll(".panel")),
        appStatus: mustGet("appStatus"),
        detectedUrl: mustGet("detectedUrl"),
        lastChecked: mustGet("lastChecked"),
        pulseDot: mustGet("pulseDot"),
        summaryTitle: mustGet("summaryTitle"),
        statusDetails: mustGet("statusDetails"),
        tileGraphStatus: mustGet("tileGraphStatus"),
        tileSlackStatus: mustGet("tileSlackStatus"),
        tilePreprodMapStatus: mustGet("tilePreprodMapStatus"),
        tileProfilesCount: mustGet("tileProfilesCount"),
        tileRulesCount: mustGet("tileRulesCount"),
        sheetTabBadge: mustGet("sheetTabBadge"),
        openSheetBtn: mustGet("openSheetBtn"),
        graphTokenStatus: mustGet("graphTokenStatus"),
        graphTokenMeta: mustGet("graphTokenMeta"),
        spfxTokenStatus: mustGet("spfxTokenStatus"),
        spfxTokenMeta: mustGet("spfxTokenMeta"),
        tapDuoStatus: mustGet("tapDuoStatus"),
        preprodMapStatus: mustGet("preprodMapStatus"),
        preprodMapMeta: mustGet("preprodMapMeta"),
        slackStatusBadge: mustGet("slackStatusBadge"),
        slackTokenMeta: mustGet("slackTokenMeta"),
        slackCookieMeta: mustGet("slackCookieMeta"),
        rulesCountBadge: mustGet("rulesCountBadge"),
        quickRulesList: mustGet("quickRulesList"),
    };
}
function formatNow() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function maskSecret(value, visibleTail = 4) {
    if (!value)
        return "—";
    if (value.length <= visibleTail)
        return "•".repeat(value.length);
    return `${"•".repeat(Math.min(10, value.length - visibleTail))}${value.slice(-visibleTail)}`;
}
function formatRelativeExpiry(expiresAtMs) {
    if (!expiresAtMs)
        return "no expiry captured";
    const remainingMs = expiresAtMs - Date.now();
    if (remainingMs <= 0)
        return "expired";
    const minutes = Math.round(remainingMs / 60000);
    if (minutes < 60)
        return `expires in ~${minutes}m`;
    return `expires in ~${Math.round(minutes / 60)}h`;
}
function queryTabs(urlPattern) {
    return new Promise((resolve) => {
        chrome.tabs.query({ url: urlPattern }, (tabs) => resolve(tabs ?? []));
    });
}
function getStoredCapture() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEY], (res) => {
            resolve(res[STORAGE_KEY] ?? {});
        });
    });
}
function initNav(els) {
    els.navButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const target = btn.dataset.panel;
            if (!target)
                return;
            els.navButtons.forEach((b) => b.classList.toggle("active", b === btn));
            els.panels.forEach((panel) => {
                panel.classList.toggle("active", panel.dataset.panel === target);
            });
        });
    });
}
async function refreshStatus(els) {
    const tabs = await queryTabs(LOCAL_URLS);
    const activeTab = tabs.find((t) => t.active) || tabs.find((t) => typeof t.url === "string");
    if (activeTab?.url) {
        els.appStatus.textContent = "Connected";
        els.appStatus.className = "value ok";
        els.detectedUrl.textContent = activeTab.url;
        els.lastChecked.textContent = formatNow();
        els.pulseDot.className = "pulse ok";
        const host = new URL(activeTab.url).host;
        els.summaryTitle.textContent = `Connected (${host})`;
        els.summaryTitle.style.color = "#4ade80";
        els.statusDetails.open = false;
    }
    else {
        els.appStatus.textContent = "Not Open";
        els.appStatus.className = "value bad";
        els.detectedUrl.textContent = "No localhost ARC tab found";
        els.lastChecked.textContent = formatNow();
        els.pulseDot.className = "pulse bad";
        els.summaryTitle.textContent = "Not Connected";
        els.summaryTitle.style.color = "#f87171";
        els.statusDetails.open = true;
    }
}
function refreshOverviewTiles(els, state) {
    const hasGraph = Boolean(state.graphApiToken);
    els.tileGraphStatus.textContent = hasGraph ? "●" : "○";
    els.tileGraphStatus.className = `tile-value ${hasGraph ? "ok" : "bad"}`;
    const hasSlack = Boolean(state.slackToken && state.slackDCookie);
    els.tileSlackStatus.textContent = hasSlack ? "●" : "○";
    els.tileSlackStatus.className = `tile-value ${hasSlack ? "ok" : "bad"}`;
    const hasPreprodMap = Boolean(state.preprodMapToken);
    els.tilePreprodMapStatus.textContent = hasPreprodMap ? "●" : "○";
    els.tilePreprodMapStatus.className = `tile-value ${hasPreprodMap ? "ok" : "bad"}`;
    els.tileProfilesCount.textContent = String(state.tekionProfiles?.length ?? 0);
}
function refreshTokensPanel(els, state) {
    const hasGraph = Boolean(state.graphApiToken);
    els.graphTokenStatus.textContent = hasGraph ? "Active" : "Inactive";
    els.graphTokenStatus.className = `value small ${hasGraph ? "ok" : "bad"}`;
    els.graphTokenMeta.textContent = hasGraph
        ? `${maskSecret(state.graphApiToken)} · ${formatRelativeExpiry(state.graphExpiresAt)}`
        : "No Graph token captured yet. Open the SharePoint T-90 page in your browser.";
    const hasSpfx = Boolean(state.spfxRefreshToken);
    els.spfxTokenStatus.textContent = hasSpfx ? "Captured" : "Not Captured";
    els.spfxTokenStatus.className = `value small ${hasSpfx ? "ok" : "bad"}`;
    els.spfxTokenMeta.textContent = hasSpfx
        ? `${maskSecret(state.spfxRefreshToken)} · ${formatRelativeExpiry(state.spfxRefreshTokenExpiresAt)}`
        : "No SPFx refresh token captured yet.";
    els.sheetTabBadge.textContent = hasGraph ? "Ready" : "Waiting for token";
    els.sheetTabBadge.className = `rules-count-badge ${hasGraph ? "" : "warn"}`;
    els.openSheetBtn.disabled = !state.sharepointWorkbookUrl;
    els.openSheetBtn.onclick = () => {
        if (state.sharepointWorkbookUrl) {
            chrome.tabs.create({ url: state.sharepointWorkbookUrl });
        }
    };
    const hasTapDuo = Boolean(state.tapDuoApiToken);
    els.tapDuoStatus.textContent = hasTapDuo ? "Captured" : "Not Captured";
    els.tapDuoStatus.className = `value small ${hasTapDuo ? "ok" : "bad"}`;
    const hasPreprod = Boolean(state.preprodMapToken);
    els.preprodMapStatus.textContent = hasPreprod ? "Captured" : "Not Captured";
    els.preprodMapStatus.className = `value small ${hasPreprod ? "ok" : "bad"}`;
    els.preprodMapMeta.textContent = hasPreprod
        ? `${maskSecret(state.preprodMapToken)} (Ready for Tenant validation & Accounts Count)`
        : "Open preprod-map.tekioncloud.com in your browser to capture credentials.";
}
function refreshSlackPanel(els, state) {
    const hasToken = Boolean(state.slackToken);
    const hasCookie = Boolean(state.slackDCookie);
    const isActive = hasToken && hasCookie;
    const isPartial = !isActive && (hasToken || hasCookie);
    els.slackStatusBadge.textContent = isActive
        ? "Active & Synced"
        : isPartial
            ? "Partially Detected"
            : "Not Detected";
    els.slackStatusBadge.className = `rules-count-badge ${isActive ? "" : "warn"}`;
    els.slackTokenMeta.textContent = hasToken
        ? maskSecret(state.slackToken)
        : "No Slack xoxc token detected yet.";
    els.slackCookieMeta.textContent = hasCookie
        ? maskSecret(state.slackDCookie)
        : "No Slack 'd' cookie detected yet.";
}
async function refreshRulesSummary(els) {
    chrome.storage.local.get([CUSTOM_RULES_STORAGE_KEY], (res) => {
        const storedValue = res[CUSTOM_RULES_STORAGE_KEY];
        const rawRules = Array.isArray(storedValue) ? storedValue : [];
        els.rulesCountBadge.textContent = `${rawRules.length} active`;
        els.tileRulesCount.textContent = String(rawRules.length);
        els.quickRulesList.innerHTML = "";
        if (rawRules.length === 0) {
            const empty = document.createElement("div");
            empty.className = "info-text";
            empty.style.fontStyle = "italic";
            empty.textContent = "No custom rules configured.";
            els.quickRulesList.appendChild(empty);
            return;
        }
        rawRules.forEach((rule) => {
            const chip = document.createElement("div");
            chip.className = "rule-chip";
            const label = document.createElement("span");
            label.className = "rule-chip-label";
            label.textContent = rule.label || rule.pattern;
            const mode = document.createElement("span");
            mode.className = "rule-chip-mode";
            mode.textContent = rule.matchMode;
            chip.appendChild(label);
            chip.appendChild(mode);
            els.quickRulesList.appendChild(chip);
        });
    });
}
async function refreshAll(els) {
    const state = await getStoredCapture();
    await refreshStatus(els);
    refreshOverviewTiles(els, state);
    refreshTokensPanel(els, state);
    refreshSlackPanel(els, state);
    await refreshRulesSummary(els);
}
async function init() {
    const els = getElements();
    const manifest = chrome.runtime.getManifest();
    els.versionChip.textContent = `v${manifest.version}`;
    initNav(els);
    els.openAppBtn.addEventListener("click", () => {
        chrome.tabs.create({ url: "http://localhost:5175" });
    });
    els.refreshBtn.addEventListener("click", () => {
        void refreshAll(els);
    });
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local" && (changes[STORAGE_KEY] || changes[CUSTOM_RULES_STORAGE_KEY])) {
            void refreshAll(els);
        }
    });
    await refreshAll(els);
}
void init();
export {};
