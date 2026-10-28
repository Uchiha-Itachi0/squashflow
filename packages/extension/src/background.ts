/**
 * Service worker. Pin mode is injected only into the tab the user acts on, using the
 * activeTab grant from the toolbar click or keyboard shortcut; there are no host
 * permissions and no content scripts declared for any site. Every call to the local
 * helper is made from here, never from the pin mode script or the page.
 */

import pinModeUrl from "url:./inject/pin-mode.ts";
import { ConnectionStore, indexedDbArea } from "./helper/connection";
import { HelperService } from "./helper/service";
import { SiteRepoStore } from "./helper/sites";
import { StatusTracker } from "./helper/tracker";
import { PinStatusStore } from "./status/store";

/**
 * Plasmo emits the pin mode script at the extension root under a hashed name. Only the
 * name is used: the URL's base comes from a stack trace, and the name does not need it.
 */
const PIN_MODE_FILE = pinModeUrl.slice(pinModeUrl.lastIndexOf("/") + 1);

const fetchHelper = (url: string, init: RequestInit): Promise<Response> => fetch(url, init);
const connections = new ConnectionStore(indexedDbArea());
const tracker = new StatusTracker({
  fetch: fetchHelper,
  connections,
  store: new PinStatusStore(chrome.storage.local),
});
const helper = new HelperService({
  fetch: fetchHelper,
  connections,
  sites: new SiteRepoStore(chrome.storage.local),
  tracker,
});

// The worker is stopped when idle and loses its event stream; each start catches up.
void tracker.sync();

chrome.action.onClicked.addListener((tab) => {
  void togglePinMode(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's own pin mode script; there is no externally_connectable.
  if (sender.id !== chrome.runtime.id) return false;
  void helper.handle(message).then(sendResponse);
  return true;
});

async function togglePinMode(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || !isWebPage(tab.url)) {
    await flagUnsupported(tab.id);
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [PIN_MODE_FILE] });
  } catch {
    // Pages the browser protects (the Web Store, other extensions) refuse injection.
    await flagUnsupported(tab.id);
  }
}

function isWebPage(url: string | undefined): boolean {
  return url !== undefined && /^https?:\/\//.test(url);
}

async function flagUnsupported(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) return;
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#D93F5B" });
  await chrome.action.setBadgeText({ tabId, text: "!" });
  await chrome.action.setTitle({
    tabId,
    title: "Squashflow can pin only on http and https pages.",
  });
}
