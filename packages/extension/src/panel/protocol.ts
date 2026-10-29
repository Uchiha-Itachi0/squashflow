/**
 * Messages between the side panel and the pin mode script in the page, over one port
 * the panel opens to the active tab. The page side holds only what happens on the page
 * (the toolbar, markers, the comment box); the panel holds everything else, sending
 * included, and can stop pin mode. What the page sends is validated here, because
 * the pin mode script runs in the page's renderer.
 *
 * Two one-off runtime messages go to the service worker instead: the pin mode script
 * asks it to open the side panel, and the panel asks it to start pin mode on a tab.
 * The pin mode script also announces that it started, so an open panel connects to it.
 */

import { pageUrlSchema } from "@squashflow/shared";
// Namespace import: Parcel (the extension bundler) mis-bundles zod's `z` re-export.
import * as z from "zod";

export const PANEL_PORT = "squashflow-panel";

const pinIdSchema = z.string().regex(/^sf-[0-9a-f]{12}$/);

export const pageToPanelSchema = z.discriminatedUnion("type", [
  /** First message on the port: the page the pins are on. */
  z.strictObject({ type: z.literal("hello"), url: pageUrlSchema }),
  /** A pin was just saved in Send now mode: preview it. */
  z.strictObject({ type: z.literal("send-pin"), pinId: pinIdSchema }),
  /** A marker was clicked: open that pin's thread. */
  z.strictObject({ type: z.literal("open-pin"), pinId: pinIdSchema }),
]);

export type PageToPanel = z.infer<typeof pageToPanelSchema>;

export type PanelToPage = { type: "stop" };

/** Runtime messages to the service worker that are not helper requests. */
export const OPEN_PANEL = "squashflow:open-panel";
export const START_PIN_MODE = "squashflow:start-pin-mode";
/**
 * From the service worker to a tab where the pin mode script is already loaded: start
 * again. A second injection of the same bundle does not run it again.
 */
export const START_HERE = "squashflow:start-here";
/** Broadcast by the pin mode script when it starts; the worker ignores it. */
export const PIN_MODE_STARTED = "squashflow:pin-mode-started";

export const controlMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal(OPEN_PANEL) }),
  z.strictObject({ type: z.literal(START_PIN_MODE), tabId: z.number().int().nonnegative() }),
  z.strictObject({ type: z.literal(PIN_MODE_STARTED) }),
]);

export type ControlMessage = z.infer<typeof controlMessageSchema>;
