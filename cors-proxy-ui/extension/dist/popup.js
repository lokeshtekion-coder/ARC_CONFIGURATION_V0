const LOCAL_URLS = [
    "http://localhost:5174/*",
    "http://127.0.0.1:5174/*",
];
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
        appStatus: mustGet("appStatus"),
        detectedUrl: mustGet("detectedUrl"),
        lastChecked: mustGet("lastChecked"),
        pulseDot: mustGet("pulseDot"),
        openAppBtn: mustGet("openAppBtn"),
        refreshBtn: mustGet("refreshBtn"),
        summaryTitle: mustGet("summaryTitle"),
        statusDetails: mustGet("statusDetails"),
        rulesCountBadge: mustGet("rulesCountBadge"),
        quickRulesList: mustGet("quickRulesList"),
    };
}
function formatNow() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function setHealthyState(els, url) {
    els.appStatus.textContent = "Connected";
    els.appStatus.className = "value ok";
    els.detectedUrl.textContent = url;
    els.lastChecked.textContent = formatNow();
    els.pulseDot.className = "pulse ok";
    const host = new URL(url).host;
    els.summaryTitle.textContent = `Connected (${host})`;
    els.summaryTitle.style.color = "#4ade80";
    // Collapse automatically when healthy
    els.statusDetails.open = false;
}
function setMissingState(els) {
    els.appStatus.textContent = "Not Open";
    els.appStatus.className = "value bad";
    els.detectedUrl.textContent = "No localhost ARC tab found";
    els.lastChecked.textContent = formatNow();
    els.pulseDot.className = "pulse bad";
    els.summaryTitle.textContent = "Not Connected";
    els.summaryTitle.style.color = "#f87171";
    // Expand when disconnected so diagnostics are visible
    els.statusDetails.open = true;
}
function setCheckingState(els) {
    els.appStatus.textContent = "Checking...";
    els.appStatus.className = "value warn";
    els.detectedUrl.textContent = "Scanning open tabs...";
    els.lastChecked.textContent = formatNow();
    els.pulseDot.className = "pulse";
    els.summaryTitle.textContent = "Verifying Connection...";
    els.summaryTitle.style.color = "#fbbf24";
}
function queryArcTabs() {
    return new Promise((resolve) => {
        chrome.tabs.query({ url: LOCAL_URLS }, (tabs) => resolve(tabs ?? []));
    });
}
async function refreshStatus(els) {
    setCheckingState(els);
    const tabs = await queryArcTabs();
    const activeTab = tabs.find((tab) => typeof tab.url === "string");
    if (activeTab?.url) {
        setHealthyState(els, activeTab.url);
        return;
    }
    setMissingState(els);
}
async function refreshRulesSummary(els) {
    chrome.storage.local.get([CUSTOM_RULES_STORAGE_KEY], (res) => {
        const storedValue = res[CUSTOM_RULES_STORAGE_KEY];
        const rawRules = Array.isArray(storedValue) ? storedValue : [];
        els.rulesCountBadge.textContent = `${rawRules.length} active`;
        els.quickRulesList.innerHTML = "";
        if (rawRules.length === 0) {
            const empty = document.createElement("div");
            empty.className = "info-text";
            empty.style.fontStyle = "italic";
            empty.textContent = "No custom rules configured.";
            els.quickRulesList.appendChild(empty);
            return;
        }
        rawRules.slice(0, 3).forEach((rule) => {
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
        if (rawRules.length > 3) {
            const more = document.createElement("div");
            more.className = "info-text";
            more.style.textAlign = "right";
            more.textContent = `+ ${rawRules.length - 3} more in settings`;
            els.quickRulesList.appendChild(more);
        }
    });
}
async function init() {
    const els = getElements();
    const manifest = chrome.runtime.getManifest();
    els.versionChip.textContent = `v${manifest.version}`;
    els.openAppBtn.addEventListener("click", () => {
        chrome.tabs.create({ url: "http://localhost:5174" });
    });
    els.refreshBtn.addEventListener("click", () => {
        void refreshStatus(els);
        void refreshRulesSummary(els);
    });
    await refreshStatus(els);
    await refreshRulesSummary(els);
}
void init();
export {};
