const LOCAL_URLS = [
  "http://localhost:5174/*",
  "http://127.0.0.1:5174/*",
];

function mustGet(id: string): HTMLElement {
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
  };
}

function formatNow(): string {
  return new Date().toLocaleString();
}

function setHealthyState(els: ReturnType<typeof getElements>, url: string) {
  els.appStatus.textContent = "Connected";
  els.appStatus.className = "value ok";
  els.detectedUrl.textContent = url;
  els.lastChecked.textContent = formatNow();
  els.pulseDot.className = "pulse ok";
}

function setMissingState(els: ReturnType<typeof getElements>) {
  els.appStatus.textContent = "Not Open";
  els.appStatus.className = "value bad";
  els.detectedUrl.textContent = "No localhost ARC tab found";
  els.lastChecked.textContent = formatNow();
  els.pulseDot.className = "pulse bad";
}

function setCheckingState(els: ReturnType<typeof getElements>) {
  els.appStatus.textContent = "Checking...";
  els.appStatus.className = "value warn";
  els.detectedUrl.textContent = "Scanning open tabs";
  els.lastChecked.textContent = formatNow();
  els.pulseDot.className = "pulse";
}

function queryArcTabs(): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: LOCAL_URLS }, (tabs) => {
      resolve(tabs ?? []);
    });
  });
}

async function refreshStatus(els: ReturnType<typeof getElements>) {
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

function setVersion(els: ReturnType<typeof getElements>) {
  const version = chrome.runtime.getManifest().version;
  els.versionChip.textContent = `v${version}`;
}

async function init() {
  const els = getElements();
  setVersion(els);

  els.openAppBtn.addEventListener("click", () => {
    openArcApp();
  });

  els.refreshBtn.addEventListener("click", () => {
    void refreshStatus(els);
  });

  await refreshStatus(els);
}

void init();
