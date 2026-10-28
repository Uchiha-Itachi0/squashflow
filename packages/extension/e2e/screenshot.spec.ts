/**
 * Pin a dragged area: the pin keeps a region screenshot of the visible tab, taken with the
 * pin UI hidden. Sending it, the previewed message names the screenshot file and its
 * SHA-256, and the fake session receives that reference while the helper writes exactly
 * that image to a user-only file.
 */

import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { launchExtension, type ExtensionHarness } from "./harness";
import { startHelper, type RunningHelper } from "./helper-harness";

const DEMO = {
  pid: 4545,
  name: "e2e-shots",
  status: "idle",
  remote: "git@github.com:acme/demo.git",
} as const;
interface StoredShot {
  type: string;
  data: string;
  width: number;
  height: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let harness: ExtensionHarness;
let helper: RunningHelper;

test.beforeAll(async () => {
  helper = await startHelper([DEMO]);
  harness = await launchExtension();
});

test.afterAll(async () => {
  await harness.close();
  await helper.close();
});

test("pin an area, send it, and the session gets its screenshot", async () => {
  const page = await harness.context.newPage();
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(`${harness.origin}/`);
  await harness.togglePinMode(page);
  const panel = page.getByRole("region", { name: "Squashflow pins" });

  // Drag an area around the pricing card.
  const card = await page.locator(".card").boundingBox();
  if (card === null) throw new Error("no card");
  await page.mouse.move(card.x - 4, card.y - 4);
  await page.mouse.down();
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2, { steps: 4 });
  await page.mouse.move(card.x + card.width + 4, card.y + card.height + 4, { steps: 4 });
  await page.mouse.up();
  const box = page.getByRole("textbox", { name: "Comment" });
  await expect(box).toBeFocused();
  await expect(page.getByRole("checkbox", { name: "Include screenshot" })).toBeChecked();
  await box.fill("Tighten the pricing card");
  await page.getByRole("button", { name: "Save" }).click();

  const row = panel.locator("li", { hasText: "Tighten the pricing card" });
  await expect(row.getByText("Screenshot", { exact: true })).toBeVisible();
  const worker = await harness.worker();
  const stored: Record<string, { screenshot?: StoredShot }[]> = await worker.evaluate(() =>
    chrome.storage.local.get(null),
  );
  const shot = stored[`pins:${harness.origin}/`]?.[0]?.screenshot;
  expect(shot?.type).toBe("image/png");
  // The area plus its margin, in device pixels; never the whole tab.
  expect(shot?.height).toBeGreaterThan(card.height);
  expect(shot?.height).toBeLessThan(card.height + 40);

  await panel.getByRole("button", { name: "Pair with helper" }).click();
  await panel.getByRole("textbox", { name: "Pairing code" }).fill(helper.pairingCode);
  await panel.getByRole("spinbutton", { name: "Helper port" }).fill(String(helper.port));
  await panel.getByRole("button", { name: "Pair", exact: true }).click();
  await panel.getByRole("radio", { name: /e2e-shots/ }).check();

  await panel.getByRole("button", { name: "Send pin 1" }).click();
  const dialog = page.getByRole("dialog", { name: "Message preview" });
  const previewed = await dialog.locator("pre").innerText();
  const pinId = /\[(sf-[0-9a-f]{12})\]/.exec(previewed)?.[1] ?? "";
  const file = join(helper.home, "screenshots", pinId, "pin-1.png");
  const sha256 = createHash("sha256")
    .update(Buffer.from(shot?.data ?? "", "base64"))
    .digest("hex");
  expect(previewed).toContain("<untrusted-page-screenshots>");
  expect(previewed).toContain(`read the image file ${file} (SHA-256 ${sha256})`);

  await dialog.getByRole("button", { name: "Send to claude@e2e-shots" }).click();
  await expect(panel.getByRole("status")).toHaveText("Sent 1 pin to claude@e2e-shots.");
  const line = JSON.parse(await helper.received(DEMO.pid)) as { message: { content: string } };
  expect(line.message.content).toContain(`\n${previewed}\n</cross-session-message>`);
  expect(line.message.content).not.toContain(shot?.data.slice(0, 40));

  const written = await readFile(file);
  expect(written.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  expect(createHash("sha256").update(written).digest("hex")).toBe(sha256);
  expect((await stat(file)).mode & 0o777).toBe(0o600);
});
