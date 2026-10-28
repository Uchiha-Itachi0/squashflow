/**
 * Injected into the active tab when the user clicks the toolbar button, presses the
 * shortcut, or presses Start pinning in the side panel. It starts pin mode, and stays
 * loaded in the page's isolated world: the bundle runs only once per page, so later
 * starts on the same page come as a message from the service worker. Starting while pin
 * mode runs leaves it running. Pin mode stops from its toolbar, Escape, or the side panel.
 */

import { START_HERE } from "../panel/protocol";
import { PinMode } from "../pin-mode/controller";
import { PinStore } from "../store/pins";

declare global {
  var squashflowPinMode: PinMode | undefined;
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const isStart =
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === START_HERE;
  // Only this extension's service worker; pages cannot message the isolated world.
  if (!isStart || sender.id !== chrome.runtime.id || sender.tab !== undefined) return false;
  start();
  sendResponse(true);
  return false;
});

function start(): void {
  if (globalThis.squashflowPinMode !== undefined) return;
  const mode = new PinMode(new PinStore(chrome.storage.local, location.href), () => {
    globalThis.squashflowPinMode = undefined;
  });
  globalThis.squashflowPinMode = mode;
  void mode.start();
}

start();
