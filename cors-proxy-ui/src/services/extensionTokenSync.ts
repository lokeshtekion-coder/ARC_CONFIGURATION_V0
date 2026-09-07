import { saveTekionApiSettings } from "./tekionApiSettings";
import {
  saveArcBrowserCapture,
  type ArcBrowserCaptureState,
} from "./extensionCaptureStore";

interface ExtensionSyncMessage {
  type: "ARC_EXTENSION_SYNC_CAPTURE";
  payload?: ArcBrowserCaptureState;
}

declare global {
  interface Window {
    __ARC_EXTENSION_TOKEN_SYNC_ACTIVE__?: boolean;
    __ARC_EXTENSION_TOKEN_SYNC_CLEANUP__?: () => void;
  }
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function registerExtensionTokenSync(): () => void {
  if (window.__ARC_EXTENSION_TOKEN_SYNC_ACTIVE__) {
    return window.__ARC_EXTENSION_TOKEN_SYNC_CLEANUP__ ?? (() => {});
  }

  const onMessage = (event: MessageEvent<ExtensionSyncMessage>) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    if (event.data?.type !== "ARC_EXTENSION_SYNC_CAPTURE") return;

    const payload = event.data.payload;
    if (!payload || typeof payload !== "object") return;

    saveArcBrowserCapture(payload);

    const nextSettings: Record<string, string> = {};
    const tapDuoApiToken = trimmed(payload.tapDuoApiToken);
    const graphApiToken = trimmed(payload.graphApiToken);

    if (tapDuoApiToken) {
      nextSettings.tapDuoApiToken = tapDuoApiToken;
    }

    if (graphApiToken) {
      nextSettings.graphApiToken = graphApiToken;
    }

    if (Object.keys(nextSettings).length > 0) {
      saveTekionApiSettings(nextSettings);
    }

    window.dispatchEvent(
      new CustomEvent("arc-extension-capture-updated", {
        detail: payload,
      })
    );

    console.log("[ARC Extension] Capture synced", {
      savedSettingKeys: Object.keys(nextSettings),
      graphCapturedAt: payload.lastGraphCaptureAt,
      tekionImplementationCapturedAt: payload.lastTekionImplementationCaptureAt,
      tekionBootstrapCapturedAt: payload.lastTekionBootstrapCaptureAt,
      tekionProdTechMotorsCapturedAt: payload.lastTekionProdTechMotorsCaptureAt,
    });
  };

  const requestLatest = () => {
    window.postMessage(
      {
        type: "ARC_EXTENSION_BRIDGE_REQUEST_LATEST",
      },
      window.location.origin
    );
  };

  window.addEventListener("message", onMessage);

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", requestLatest, { once: true });
  } else {
    window.setTimeout(requestLatest, 0);
  }

  const cleanup = () => {
    window.removeEventListener("message", onMessage);
    window.__ARC_EXTENSION_TOKEN_SYNC_ACTIVE__ = false;
    window.__ARC_EXTENSION_TOKEN_SYNC_CLEANUP__ = undefined;
  };

  window.__ARC_EXTENSION_TOKEN_SYNC_ACTIVE__ = true;
  window.__ARC_EXTENSION_TOKEN_SYNC_CLEANUP__ = cleanup;

  return cleanup;
}
