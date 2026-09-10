const PAGE_SYNC_EVENT = "ARC_EXTENSION_SYNC_CAPTURE";
const PAGE_SYNC_RULES_EVENT = "ARC_EXTENSION_SYNC_RULES";
const PAGE_REQUEST_EVENT = "ARC_EXTENSION_BRIDGE_REQUEST_LATEST";
const PAGE_GET_RULES_EVENT = "ARC_EXTENSION_BRIDGE_GET_RULES";
const PAGE_SAVE_RULES_EVENT = "ARC_EXTENSION_BRIDGE_SAVE_RULES";
function postMessageToPage(type, payload) {
    window.postMessage({ type, payload }, window.location.origin);
}
// 1. Listen for messages pushed from the background service worker
chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "ARC_PUSH_CAPTURE") {
        postMessageToPage(PAGE_SYNC_EVENT, message.payload);
    }
});
// 2. Relay requests from the React app to the Chrome background runtime
window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin)
        return;
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
        chrome.runtime.sendMessage({
            type: "ARC_SAVE_CUSTOM_RULES",
            payload: event.data.payload,
        });
    }
});
export {};
