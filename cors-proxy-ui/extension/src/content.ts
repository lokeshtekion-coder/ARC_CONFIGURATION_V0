const PAGE_SYNC_EVENT = "ARC_EXTENSION_SYNC_CAPTURE";
const PAGE_SYNC_RULES_EVENT = "ARC_EXTENSION_SYNC_RULES";

const PAGE_REQUEST_EVENT = "ARC_EXTENSION_BRIDGE_REQUEST_LATEST";
const PAGE_GET_RULES_EVENT = "ARC_EXTENSION_BRIDGE_GET_RULES";
const PAGE_SAVE_RULES_EVENT = "ARC_EXTENSION_BRIDGE_SAVE_RULES";

const RULES_STORAGE_KEY = "arcCustomWatchedApis";

function postMessageToPage(type: string, payload: unknown): void {
  window.postMessage({ type, payload }, window.location.origin);
}

// 1. Listen for rule changes written directly to chrome.storage (e.g. by the
//    background script's own cleanup/init logic) and relay them to the page.
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== "local") return;

  if (changes[RULES_STORAGE_KEY]) {
    postMessageToPage(PAGE_SYNC_RULES_EVENT, changes[RULES_STORAGE_KEY].newValue);
  }
});

// 2. Listen for messages pushed from the background service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "ARC_PUSH_CAPTURE") {
    postMessageToPage(PAGE_SYNC_EVENT, message.payload);
  }
});

// 3. Relay requests from the React app to the Chrome background runtime
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
          console.error(
            "[Content Script] Failed to save rules:",
            chrome.runtime.lastError.message
          );
          return;
        }
        // Confirm back to the page with what the background actually persisted,
        // in case it normalized/rejected any entries.
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