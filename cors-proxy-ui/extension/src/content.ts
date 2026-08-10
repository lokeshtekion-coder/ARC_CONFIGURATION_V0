const PAGE_SYNC_EVENT = "ARC_EXTENSION_SYNC_CAPTURE";
const PAGE_REQUEST_EVENT = "ARC_EXTENSION_BRIDGE_REQUEST_LATEST";

function postCaptureToPage(payload: unknown): void {
  if (!payload) return;

  window.postMessage(
    {
      type: PAGE_SYNC_EVENT,
      payload,
    },
    window.location.origin
  );
}

function requestLatestCaptureFromBackground(): void {
  chrome.runtime.sendMessage(
    {
      type: "ARC_GET_LATEST_CAPTURE",
    },
    (response) => {
      if (chrome.runtime.lastError) return;
      postCaptureToPage(response?.payload ?? null);
    }
  );
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "ARC_PUSH_CAPTURE") return;
  postCaptureToPage(message.payload);
});

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  if (event.data?.type !== PAGE_REQUEST_EVENT) return;

  requestLatestCaptureFromBackground();
});

