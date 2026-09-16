const PAGE_SYNC_EVENT = "ARC_EXTENSION_SYNC_CAPTURE";
const PAGE_SYNC_RULES_EVENT = "ARC_EXTENSION_SYNC_RULES";

const PAGE_REQUEST_EVENT = "ARC_EXTENSION_BRIDGE_REQUEST_LATEST";
const PAGE_GET_RULES_EVENT = "ARC_EXTENSION_BRIDGE_GET_RULES";
const PAGE_SAVE_RULES_EVENT = "ARC_EXTENSION_BRIDGE_SAVE_RULES";

const RULES_STORAGE_KEY = "arcCustomWatchedApis";

function postMessageToPage(type: string, payload: unknown): void {
  window.postMessage({ type, payload }, window.location.origin);
}

// 1. Storage changes relayed to React web app
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== "local") return;
  if (changes[RULES_STORAGE_KEY]) {
    postMessageToPage(PAGE_SYNC_RULES_EVENT, changes[RULES_STORAGE_KEY].newValue);
  }
});

// 2. Listen for push updates or log relays from background service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "ARC_PUSH_CAPTURE") {
    console.log("[ARC Extension] Push captured state received:", message.payload);
    postMessageToPage(PAGE_SYNC_EVENT, message.payload);
  }

  if (message?.type === "ARC_LOG_RELAY") {
    // Bridges background logs directly into your React DevTools console
    console.log("%c[ARC Extension]", "color: #38bdf8; font-weight: bold;", ...message.payload);
  }
});

// 3. Relay requests from React app to background service worker
window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;

  if (event.data?.type === PAGE_REQUEST_EVENT) {
    chrome.runtime.sendMessage({ type: "ARC_GET_LATEST_CAPTURE" }, (response) => {
      if (!chrome.runtime.lastError && response?.payload) {
        postMessageToPage(PAGE_SYNC_EVENT, response.payload);
      }
    });
  }

  if (event.data?.type === PAGE_GET_RULES_EVENT) {
    chrome.runtime.sendMessage({ type: "ARC_GET_CUSTOM_RULES" }, (response) => {
      if (!chrome.runtime.lastError && response?.payload) {
        postMessageToPage(PAGE_SYNC_RULES_EVENT, response.payload);
      }
    });
  }

  if (event.data?.type === PAGE_SAVE_RULES_EVENT) {
    chrome.runtime.sendMessage(
      { type: "ARC_SAVE_CUSTOM_RULES", payload: event.data.payload },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error("[Content Script] Failed to save rules:", chrome.runtime.lastError.message);
          return;
        }
        if (response?.success) {
          chrome.runtime.sendMessage({ type: "ARC_GET_CUSTOM_RULES" }, (rulesResponse) => {
            if (!chrome.runtime.lastError && rulesResponse?.payload) {
              postMessageToPage(PAGE_SYNC_RULES_EVENT, rulesResponse.payload);
            }
          });
        }
      }
    );
  }
});