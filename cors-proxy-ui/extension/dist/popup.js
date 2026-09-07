const LOCAL_URLS = [
    "http://localhost:5174/*",
    "http://127.0.0.1:5174/*",
];
const CUSTOM_RULES_STORAGE_KEY = "arcCustomWatchedApis";
const DEFAULT_EXPIRY_HOURS = 48;
function mustGet(id) {
    const el = document.getElementById(id);
    if (!el) {
        throw new Error(`Missing popup element: ${id}`);
    }
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
        customUrlInput: mustGet("customUrlInput"),
        customLabelInput: mustGet("customLabelInput"),
        customMatchMode: mustGet("customMatchMode"),
        customExpiryInput: mustGet("customExpiryInput"),
        addUrlBtn: mustGet("addUrlBtn"),
        watchedUrlsList: mustGet("watchedUrlsList"),
    };
}
function formatNow() {
    return new Date().toLocaleString();
}
function setHealthyState(els, url) {
    els.appStatus.textContent = "Connected";
    els.appStatus.className = "value ok";
    els.detectedUrl.textContent = url;
    els.lastChecked.textContent = formatNow();
    els.pulseDot.className = "pulse ok";
}
function setMissingState(els) {
    els.appStatus.textContent = "Not Open";
    els.appStatus.className = "value bad";
    els.detectedUrl.textContent = "No localhost ARC tab found";
    els.lastChecked.textContent = formatNow();
    els.pulseDot.className = "pulse bad";
}
function setCheckingState(els) {
    els.appStatus.textContent = "Checking...";
    els.appStatus.className = "value warn";
    els.detectedUrl.textContent = "Scanning open tabs";
    els.lastChecked.textContent = formatNow();
    els.pulseDot.className = "pulse";
}
function queryArcTabs() {
    return new Promise((resolve) => {
        chrome.tabs.query({ url: LOCAL_URLS }, (tabs) => {
            resolve(tabs ?? []);
        });
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
function openArcApp() {
    chrome.tabs.create({ url: "http://localhost:5174" });
}
function setVersion(els) {
    const version = chrome.runtime.getManifest().version;
    els.versionChip.textContent = `v${version}`;
}
function getStorageValue(key) {
    return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
            resolve(result[key]);
        });
    });
}
function setStorageValue(key, value) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, () => resolve());
    });
}
function slugify(input) {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 80);
}
async function loadCustomRules() {
    return (await getStorageValue(CUSTOM_RULES_STORAGE_KEY)) ?? [];
}
async function saveCustomRules(rules) {
    await setStorageValue(CUSTOM_RULES_STORAGE_KEY, rules);
}
function renderRuleRow(rule, onRemove) {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gap = "6px";
    row.style.padding = "10px";
    row.style.borderRadius = "12px";
    row.style.background = "rgba(255,255,255,0.04)";
    row.style.border = "1px solid rgba(148, 163, 184, 0.12)";
    const top = document.createElement("div");
    top.style.display = "flex";
    top.style.justifyContent = "space-between";
    top.style.alignItems = "center";
    top.style.gap = "8px";
    const title = document.createElement("div");
    title.style.color = "#e6f0ff";
    title.style.fontSize = "12px";
    title.style.fontWeight = "700";
    title.textContent = rule.label || rule.pattern;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-secondary";
    removeBtn.style.padding = "6px 10px";
    removeBtn.style.fontSize = "11px";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => onRemove(rule.id));
    top.appendChild(title);
    top.appendChild(removeBtn);
    const details = document.createElement("div");
    details.className = "value mono small";
    details.textContent = rule.pattern;
    const meta = document.createElement("div");
    meta.style.color = "#9fb1cc";
    meta.style.fontSize = "11px";
    meta.textContent = `Mode: ${rule.matchMode} • Expiry: ${rule.expiryHours}h`;
    row.appendChild(top);
    row.appendChild(details);
    row.appendChild(meta);
    return row;
}
async function renderWatchedUrls(els) {
    const rules = await loadCustomRules();
    els.watchedUrlsList.innerHTML = "";
    if (rules.length === 0) {
        const empty = document.createElement("div");
        empty.className = "value small";
        empty.style.color = "#9fb1cc";
        empty.textContent = "No custom APIs watched";
        els.watchedUrlsList.appendChild(empty);
        return;
    }
    rules.forEach((rule) => {
        els.watchedUrlsList.appendChild(renderRuleRow(rule, async (ruleId) => {
            const current = await loadCustomRules();
            const next = current.filter((item) => item.id !== ruleId);
            await saveCustomRules(next);
            await renderWatchedUrls(els);
        }));
    });
}
async function initCustomUrlListeners(els) {
    els.addUrlBtn.addEventListener("click", async () => {
        const pattern = els.customUrlInput.value.trim();
        const label = els.customLabelInput.value.trim();
        const matchMode = els.customMatchMode.value === "exact" ? "exact" : "includes";
        const expiryHours = Math.max(1, Number.parseInt(els.customExpiryInput.value || `${DEFAULT_EXPIRY_HOURS}`, 10) ||
            DEFAULT_EXPIRY_HOURS);
        if (!pattern)
            return;
        const rules = await loadCustomRules();
        const id = slugify(`${label || pattern}__${matchMode}`);
        const nextRule = {
            id,
            label: label || pattern,
            pattern,
            matchMode,
            expiryHours,
            createdAt: new Date().toISOString(),
        };
        const existingIndex = rules.findIndex((item) => item.id === id);
        if (existingIndex >= 0) {
            rules[existingIndex] = nextRule;
        }
        else {
            rules.unshift(nextRule);
        }
        await saveCustomRules(rules);
        els.customUrlInput.value = "";
        els.customLabelInput.value = "";
        els.customMatchMode.value = "includes";
        els.customExpiryInput.value = `${DEFAULT_EXPIRY_HOURS}`;
        await renderWatchedUrls(els);
    });
    await renderWatchedUrls(els);
}
async function init() {
    const els = getElements();
    setVersion(els);
    els.openAppBtn.addEventListener("click", () => {
        openArcApp();
    });
    els.refreshBtn.addEventListener("click", () => {
        void refreshStatus(els);
        void renderWatchedUrls(els);
    });
    await refreshStatus(els);
    await initCustomUrlListeners(els);
}
void init();
export {};
