/**
 * The built extension in Chromium on a local fixture page, with nothing connected: place
 * a pin, write a comment, and copy it from the page's toolbar and from the side panel's
 * copy mode, checking the clipboard text.
 */

import { expect, test } from "@playwright/test";
import { launchExtension, pinElement, type ExtensionHarness } from "./harness";

let harness: ExtensionHarness;

test.beforeAll(async () => {
  harness = await launchExtension();
});

test.afterAll(async () => {
  await harness.close();
});

test("pin an element, comment on it and copy it", async () => {
  const { origin } = harness;
  const panel = await harness.openPanel();
  const page = await harness.context.newPage();
  await page.goto(`${origin}/`);
  await harness.startPinMode(page);

  const toolbar = page.getByRole("toolbar", { name: "Squashflow toolbar" });
  await expect(toolbar).toBeVisible();
  // The page's `* { color: red !important }` must not reach the pin UI.
  await expect(toolbar.getByRole("button", { name: "Element" })).not.toHaveCSS(
    "color",
    "rgb(255, 0, 0)",
  );
  // The bundled font, under a name no page uses.
  await expect(toolbar).toHaveCSS("font-family", /Squashflow Geist/);

  await pinElement(page, "#buy", "Make the Buy button violet");
  expect(await page.evaluate(() => (window as unknown as { buyClicks: number }).buyClicks)).toBe(0);
  await expect(page.getByRole("button", { name: "Pin 1: draft" })).toBeVisible();

  // Skip connecting: copy mode shows exactly what Copy puts on the clipboard.
  await panel.getByRole("button", { name: "Skip, I'll just copy and paste →" }).click();
  await expect(panel.getByText("Copy mode", { exact: true })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Session: Copy mode" })).toBeVisible();
  await panel.getByRole("radio", { name: "Detailed" }).click();
  const preview = panel.getByLabel("What Copy puts on the clipboard");
  await expect(preview).toContainText("The user's comment:\n\nMake the Buy button violet");

  await toolbar.getByRole("button", { name: "Copy all pins" }).click();
  await expect(page.getByRole("status")).toHaveText(/Copied 1 pin \(detailed\)/);

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

  // The panel's own Copy works too.
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await panel.getByRole("button", { name: "Copy 1 pin" }).click();
  await expect(panel.getByRole("status")).toHaveText(/Copied 1 pin \(detailed\)/);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Make the Buy button violet",
  );

  // Open the draft, edit it, and the page's marker and the panel follow.
  await page.getByRole("button", { name: "Pin 1: draft" }).click();
  await panel.getByRole("button", { name: "Edit pin 1" }).click();
  await panel.getByRole("textbox", { name: "Edit comment" }).fill("Make the Buy button blue");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(panel.getByText("“Make the Buy button blue”")).toBeVisible();

  // The pin survives a reload, and Escape leaves pin mode.
  await page.reload();
  await harness.startPinMode(page);
  await expect(panel.getByLabel("What Copy puts on the clipboard")).toContainText(
    "Make the Buy button blue",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("squashflow-root")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Start pinning on this page" })).toBeVisible();

  // Delete from the panel.
  await panel.getByRole("button", { name: "Start pinning on this page" }).click();
  await expect(page.getByRole("button", { name: "Pin 1: draft" })).toBeVisible();
  await page.getByRole("button", { name: "Pin 1: draft" }).click();
  await panel.getByRole("button", { name: "Delete pin 1" }).click();
  await expect(page.locator("squashflow-root .marker")).toHaveCount(0);
});
