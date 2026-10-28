/**
 * Service worker. The toolbar button (or its keyboard shortcut) opens the side panel and
 * starts pin mode in the tab the user acts on, using the activeTab grant from that
 * click; there are no host permissions and no content scripts declared for any site.
 * Every call to the local helper is made from here, at the side panel's request and
 * never the pin mode script's or the page's, and so are the captures of the visible tab
 * behind region screenshots.
 */

import pinModeUrl from "url:./inject/pin-mode.ts";
import { screenshotRequestSchema } from "./capture/screenshot";
import { captureRegion } from "./capture/tab-capture";
import { ConnectionStore, indexedDbArea } from "./helper/connection";
import { HelperService } from "./helper/service";
import { SiteRepoStore } from "./helper/sites";
import { StatusTracker } from "./helper/tracker";
import {
  controlMessageSchema,
  OPEN_PANEL,
  START_HERE,
  START_PIN_MODE,
  type ControlMessage,
} from "./panel/protocol";
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
  // Opening the panel must happen in the click itself, before anything is awaited.
  void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  void startPinMode(tab.id, tab.url);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's own scripts and pages; there is no externally_connectable.
  if (sender.id !== chrome.runtime.id) return false;
  const control = controlMessageSchema.safeParse(message);
  if (control.success) return handleControl(control.data, sender, sendResponse);
  const screenshot = screenshotRequestSchema.safeParse(message);
  if (screenshot.success) {
    void captureRegion(sender.tab, screenshot.data).then(sendResponse);
    return true;
  }
  // Helper requests come only from the side panel, an extension page: never from the
  // pin mode script, which runs in the page's renderer.
  if (!isExtensionPage(sender.url)) return false;
  void helper.handle(message).then(sendResponse);
  return true;
});

function handleControl(
  message: ControlMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (reply: boolean) => void,
): boolean {
  if (message.type === OPEN_PANEL && sender.tab !== undefined) {
    // From a click on the page's toolbar; the browser may still want a click on the button.
    void chrome.sidePanel
      .open({ windowId: sender.tab.windowId })
      .then(() => sendResponse(true))
      .catch(() => sendResponse(false));
    return true;
  }
  if (message.type === START_PIN_MODE && isExtensionPage(sender.url)) {
    void startPinMode(message.tabId, undefined).then(sendResponse);
    return true;
  }
  // The pin mode script's start announcement is for the side panel.
  return false;
}

/**
 * Start pin mode in a tab. From the side panel the tab's URL is not known; injection
 * then succeeds only where the user's toolbar click granted activeTab.
 */
async function startPinMode(tabId: number | undefined, url: string | undefined): Promise<boolean> {
  if (tabId === undefined || (url !== undefined && !isWebPage(url))) {
    await flagUnsupported(tabId);
    return false;
  }
  // Loaded already (pin mode was on and stopped): the bundle does not run twice.
  const loaded: unknown = await chrome.tabs
    .sendMessage(tabId, { type: START_HERE })
    .catch(() => false);
  if (loaded === true) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [PIN_MODE_FILE] });
    return true;
  } catch {
    // Pages the browser protects (the Web Store, other extensions) refuse injection,
    // and so does any page the user has not clicked the toolbar button on.
    if (url !== undefined) await flagUnsupported(tabId);
    return false;
  }
}

function isWebPage(url: string): boolean {
  return /^https?:\/\//.test(url);
}

function isExtensionPage(url: string | undefined): boolean {
  return url !== undefined && url.startsWith(chrome.runtime.getURL(""));
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
