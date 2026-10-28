/**
 * The built extension in Chromium on a local fixture page: place a pin, write a
 * comment, copy it, and check the clipboard text.
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
  const page = await harness.context.newPage();
  await page.goto(`${origin}/`);
  await harness.togglePinMode(page);

  const panel = page.getByRole("region", { name: "Squashflow pins" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("No pins on this page yet.")).toBeVisible();
  // The page's `* { color: red !important }` must not reach the pin UI.
  await expect(panel.getByText("Squashflow", { exact: true })).not.toHaveCSS(
    "color",
    "rgb(255, 0, 0)",
  );

  await pinElement(page, "#buy", "Make the Buy button violet");
  expect(await page.evaluate(() => (window as unknown as { buyClicks: number }).buyClicks)).toBe(0);

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
  await harness.togglePinMode(page);
  await expect(panel.getByText("Make the Buy button violet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("squashflow-root")).toHaveCount(0);
});
