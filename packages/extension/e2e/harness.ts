/**
 * The built extension in Chromium, plus a local fixture page.
 *
 * Playwright cannot click the toolbar button, which is what grants activeTab and opens
 * the side panel. The harness stands in for that click: it loads a copy of the build
 * with a host permission for every site (`captureVisibleTab`, behind region screenshots,
 * accepts only activeTab or `<all_urls>`), injects the same built pin-mode script the
 * service worker injects, and opens the side panel's page in a tab of the same window,
 * where it follows the active tab as it does in the side panel. Open the panel first:
 * the page opened after it is then the active tab. The fixture is served as
 * `localhost`, so calls to the helper on 127.0.0.1 are cross-origin and go through
 * CORS, as they do for the real extension.
 */

import { expect, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const BUILD = join(here, "..", "build", "chrome-mv3-prod");
const FIXTURES = join(here, "fixture");
/** Fixture pages by path; anything else gets the test fixture. */
const PAGES: Record<string, string> = { "/store": "store.html" };

export interface ExtensionHarness {
  context: BrowserContext;
  /** The fixture page's origin, `http://localhost:<port>`. */
  origin: string;
  worker(): Promise<Worker>;
  /** The side panel's page, in a tab; open it before the page to pin on. */
  openPanel(): Promise<Page>;
  startPinMode(page: Page): Promise<void>;
  close(): Promise<void>;
}

export async function launchExtension(): Promise<ExtensionHarness> {
  const server: Server = createServer((request, response) => {
    const page = PAGES[(request.url ?? "/").split("?")[0] ?? "/"] ?? "index.html";
    void readFile(join(FIXTURES, page)).then((html) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://localhost:${(server.address() as AddressInfo).port}`;

  const extensionDir = await mkdtemp(join(tmpdir(), "squashflow-ext-"));
  await cp(BUILD, extensionDir, { recursive: true });
  const manifestPath = join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  await writeFile(manifestPath, JSON.stringify({ ...manifest, host_permissions: ["<all_urls>"] }));
  const pinModeFile = (await readdir(extensionDir)).find((name) => /^pin-mode\..*\.js$/.test(name));
  if (pinModeFile === undefined) throw new Error("Build the extension first: pnpm build");
  const background = await readFile(join(extensionDir, "static", "background", "index.js"), "utf8");
  expect(background).toContain(pinModeFile);

  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });

  const worker = async (): Promise<Worker> =>
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));

  return {
    context,
    origin,
    worker,
    openPanel: async () => {
      const sw = await worker();
      const id = new URL(sw.url()).host;
      const panel = await context.newPage();
      await panel.setViewportSize({ width: 400, height: 860 });
      await panel.goto(`chrome-extension://${id}/sidepanel.html`);
      return panel;
    },
    startPinMode: async (page) => {
      const sw = await worker();
      // The service worker loaded and registered its toolbar handler.
      expect(await sw.evaluate(() => chrome.action.onClicked.hasListeners())).toBe(true);
      await sw.evaluate(
        async ({ url, file }) => {
          const [tab] = await chrome.tabs.query({ url });
          if (tab?.id === undefined) throw new Error(`No tab at ${url}`);
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] });
        },
        { url: page.url(), file: pinModeFile },
      );
    },
    close: async () => {
      await context.close();
      await new Promise((resolve) => server.close(resolve));
      await rm(extensionDir, { recursive: true, force: true });
    },
  };
}

/** Pin an element on the page and save a comment on it. */
export async function pinElement(page: Page, selector: string, comment: string): Promise<void> {
  await page.locator(selector).click();
  const box = page.getByRole("textbox", { name: "Comment" });
  await expect(box).toBeFocused();
  await box.fill(comment);
  await page.getByRole("button", { name: "Save pin" }).click();
}

/** Pair the side panel with the helper: the port in Settings, then the code on the inbox. */
export async function pair(panel: Page, code: string, port: number): Promise<void> {
  await panel.getByRole("button", { name: "Settings" }).click();
  await panel.getByRole("spinbutton", { name: "Port" }).fill(String(port));
  await panel.getByRole("button", { name: "Back to all pins" }).click();
  await panel.getByRole("textbox", { name: "Type the code it prints" }).fill(code);
  await panel.getByRole("button", { name: "Connect", exact: true }).click();
}
