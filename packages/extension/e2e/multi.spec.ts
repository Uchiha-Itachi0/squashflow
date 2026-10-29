/**
 * The built extension in Chromium on a local fixture page: pin several elements at once
 * with Multi. The pin is one pin, and each element it covers is numbered on the page and
 * listed in the side panel's Details.
 */

import { expect, test } from "@playwright/test";
import { launchExtension, type ExtensionHarness } from "./harness";

let harness: ExtensionHarness;

test.beforeAll(async () => {
  harness = await launchExtension();
});

test.afterAll(async () => {
  await harness.close();
});

test("pin several elements with Multi: each is numbered on the page and listed in Details", async () => {
  const { origin } = harness;
  const panel = await harness.openPanel();
  const page = await harness.context.newPage();
  await page.goto(`${origin}/`);
  await harness.startPinMode(page);

  const toolbar = page.getByRole("toolbar", { name: "Squashflow toolbar" });
  await toolbar.getByRole("button", { name: "Multi" }).click();
  await page.locator("h1").click();
  await page.locator("#buy").click();
  const selected = page.locator("squashflow-root .box.selected .tag");
  await expect(selected).toHaveText(["1", "2"]);

  await toolbar.getByRole("button", { name: "Pin 2 selected" }).click();
  const box = page.getByRole("textbox", { name: "Comment" });
  await expect(box).toBeFocused();
  await box.fill("Make these match");
  await page.getByRole("button", { name: "Save pin" }).click();

  // One pin, with every element it covers outlined and numbered after it.
  await expect(page.locator("squashflow-root .marker")).toHaveCount(1);
  await expect(page.locator("squashflow-root .box.part .tag")).toHaveText(["1.1", "1.2"]);

  await page.getByRole("button", { name: "Pin 1: draft" }).click();
  await panel.getByRole("button", { name: "Details" }).click();
  const details = panel.getByRole("region", { name: "Details" });
  await expect(details.getByText("Element 1", { exact: true })).toBeVisible();
  await expect(details.getByText("Element 2", { exact: true })).toBeVisible();
  await expect(details.getByText("#buy", { exact: true })).toBeVisible();
});
