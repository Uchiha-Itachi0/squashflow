/**
 * The built extension in Chromium on a local fixture page: place a pin, write a
 * comment, copy it, and check the clipboard text.
 *
 * Playwright cannot click the toolbar button, which is what grants activeTab. The test
 * stands in for that click: it loads a copy of the build with a host permission for
 * 127.0.0.1 only, and injects the same built pin-mode script the service worker injects.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const BUILD = join(here, "..", "build", "chrome-mv3-prod");
const FIXTURE = join(here, "fixture", "index.html");

let server: Server;
let origin: string;
let extensionDir: string;
let pinModeFile: string;
let context: BrowserContext;

test.beforeAll(async () => {
  const html = await readFile(FIXTURE);
  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  extensionDir = await mkdtemp(join(tmpdir(), "squashflow-ext-"));
  await cp(BUILD, extensionDir, { recursive: true });
  const manifestPath = join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  await writeFile(
    manifestPath,
    JSON.stringify({ ...manifest, host_permissions: ["http://127.0.0.1/*"] }),
  );
  const file = (await readdir(extensionDir)).find((name) => /^pin-mode\..*\.js$/.test(name));
  if (file === undefined) throw new Error("Build the extension first: pnpm build");
  pinModeFile = file;
  const background = await readFile(join(extensionDir, "static", "background", "index.js"), "utf8");
  expect(background).toContain(file);

  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
});

test.afterAll(async () => {
  await context.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(extensionDir, { recursive: true, force: true });
});

async function togglePinMode(page: Page): Promise<void> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  // The service worker loaded and registered its toolbar handler.
  expect(await worker.evaluate(() => chrome.action.onClicked.hasListeners())).toBe(true);
  await worker.evaluate(
    async ({ url, file }) => {
      const [tab] = await chrome.tabs.query({ url });
      if (tab?.id === undefined) throw new Error(`No tab at ${url}`);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] });
    },
    { url: page.url(), file: pinModeFile },
  );
}

test("pin an element, comment on it and copy it", async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/`);
  await togglePinMode(page);

  const panel = page.getByRole("region", { name: "Squashflow pins" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("No pins on this page yet.")).toBeVisible();
  // The page's `* { color: red !important }` must not reach the pin UI.
  await expect(panel.getByText("Squashflow", { exact: true })).not.toHaveCSS(
    "color",
    "rgb(255, 0, 0)",
  );

  await page.locator("#buy").click();
  expect(await page.evaluate(() => (window as unknown as { buyClicks: number }).buyClicks)).toBe(0);

  const comment = page.getByRole("textbox", { name: "Comment" });
  await expect(comment).toBeFocused();
  await comment.fill("Make the Buy button violet");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("button", { name: "Edit pin 1" }).first()).toBeVisible();
  await expect(panel.getByText("Make the Buy button violet")).toBeVisible();

  await panel.getByRole("combobox", { name: "Copy detail level" }).selectOption("detailed");
  await panel.getByRole("button", { name: "Copy pin 1" }).click();
  await expect(panel.getByRole("status")).toHaveText(/Copied 1 pin \(detailed\)/);

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^Squashflow pin \[sf-[0-9a-f]{12}\] copied from the user's browser/);
  expect(copied).toContain(`Page: ${origin}/`);
  expect(copied).toContain("The user's comment:\n\nMake the Buy button violet");
  expect(copied).toContain("<untrusted-page-context>");
  expect(copied).toContain('"selector": "#buy"');
  expect(copied).toContain('"text": "Buy now"');
  expect(copied).toContain('"styles"');
  expect(copied).toContain("Requested outcome:");
  expect(copied).not.toContain("hunter2-secret");
  expect(copied).not.toContain("person@example.com");

  // The pin survives a reload, and Escape leaves pin mode.
  await page.reload();
  await togglePinMode(page);
  await expect(panel.getByText("Make the Buy button violet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("squashflow-root")).toHaveCount(0);
});
