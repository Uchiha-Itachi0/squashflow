/**
 * The built extension in Chromium on a local fixture page, with nothing connected: place
 * a pin, write a comment, and copy it by hand from the side panel, checking the clipboard
 * text.
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

  // Skip connecting: the pins are copied by hand, at the chosen detail.
  await panel.getByRole("button", { name: "Skip. I'll copy pins by hand." }).click();
  await expect(panel.getByText("Copy by hand", { exact: true })).toBeVisible();
  const onPage = panel.getByRole("region", { name: "On this page" });
  await expect(onPage.getByRole("button", { name: "Open pin 1" })).toContainText(
    "Make the Buy button violet",
  );
  // How much a copy includes lives in Settings; Escape comes back to the pins.
  await panel.getByRole("button", { name: "Change in Settings" }).click();
  await panel.getByRole("radio", { name: "Full" }).click();
  await panel.keyboard.press("Escape");
  await expect(panel.getByText(/^Includes: Full\./)).toBeVisible();
  await panel.getByRole("button", { name: "Copy 1 pin" }).click();
  await expect(panel.getByRole("status")).toHaveText(/Copied 1 pin \(Full\)/);

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

  // Open the draft from its marker, copy just it, edit it, and the panel follows.
  await page.getByRole("button", { name: "Pin 1: draft" }).click();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await panel.getByRole("button", { name: "Copy pin 1" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("Make the Buy button violet");
  await panel.getByRole("button", { name: "Edit pin 1" }).click();
  await panel.getByRole("textbox", { name: "Edit comment" }).fill("Make the Buy button blue");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(panel.getByLabel("Your pin")).toHaveText("Make the Buy button blue");

  // The pin survives a reload, and Escape leaves pin mode.
  await page.reload();
  await harness.startPinMode(page);
  await expect(panel.getByRole("button", { name: "Open pin 1" })).toContainText(
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
