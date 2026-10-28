/**
 * Injected into the active tab when the user clicks the toolbar button or presses the
 * shortcut. Each injection toggles pin mode: the isolated world keeps the running
 * instance between injections on the same page.
 */

import { PinMode } from "../pin-mode/controller";
import { PinStore } from "../store/pins";

declare global {
  var squashflowPinMode: PinMode | undefined;
}

function toggle(): void {
  const running = globalThis.squashflowPinMode;
  if (running !== undefined) {
    running.stop();
    return;
  }
  const mode = new PinMode(new PinStore(chrome.storage.local, location.href), () => {
    globalThis.squashflowPinMode = undefined;
  });
  globalThis.squashflowPinMode = mode;
  void mode.start();
}

toggle();
