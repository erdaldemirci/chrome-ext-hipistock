import type { ExtensionMessage } from "../lib/types";
import { handleMessage } from "./handlers";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void chrome.storage.local.remove(["vault"]);
  void chrome.storage.session.remove(["session"]);
});

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    void handleMessage(message, sendResponse).catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Bilinmeyen hata",
      });
    });
    return true;
  },
);
