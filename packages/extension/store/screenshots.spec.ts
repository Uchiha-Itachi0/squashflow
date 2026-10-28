/**
 * The Chrome Web Store screenshots, taken of the real built extension on the local demo
 * page (`e2e/fixture/store.html`), paired with the real helper running against a fake
 * Claude Code session. Writes 1280×800 PNGs to store/screenshots/.
 *
 * Build first, then: pnpm --filter @squashflow/extension store:screenshots
 */

import { expect, test, type Page } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchExtension, type ExtensionHarness } from "../e2e/harness";
import { startHelper, type RunningHelper } from "../e2e/helper-harness";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "screenshots");
const SIZE = { width: 1280, height: 800 };
const SESSION = {
  pid: 4646,
  name: "northwind-web",
  status: "idle",
  remote: "git@github.com:northwind/notes-web.git",
} as const;

let harness: ExtensionHarness;
let helper: RunningHelper;

test.beforeAll(async () => {
  helper = await startHelper([SESSION]);
  harness = await launchExtension();
});

test.afterAll(async () => {
  await harness.close();
  await helper.close();
});

async function shoot(page: Page, name: string): Promise<void> {
  await page.mouse.move(SIZE.width - 1, SIZE.height - 1);
  await page.screenshot({ path: join(OUT, name) });
}

test("store screenshots", async () => {
  const page = await harness.context.newPage();
  await page.setViewportSize(SIZE);
  await page.goto(`${harness.origin}/store`);
  await harness.togglePinMode(page);
  const panel = page.getByRole("region", { name: "Squashflow pins" });

  // 1. Drag an area around the Pro plan and comment on it.
  const plan = await page.locator("#pro").boundingBox();
  if (plan === null) throw new Error("no plan card");
  await page.mouse.move(plan.x - 6, plan.y - 6);
  await page.mouse.down();
  await page.mouse.move(plan.x + plan.width / 2, plan.y + plan.height / 2, { steps: 4 });
  await page.mouse.move(plan.x + plan.width + 6, plan.y + plan.height + 6, { steps: 4 });
  await page.mouse.up();
  const box = page.getByRole("textbox", { name: "Comment" });
  await expect(box).toBeFocused();
  await box.fill("Make the Pro card stand out: violet border and a “Most popular” badge.");
  await shoot(page, "1-pin-an-area.png");
  await page.getByRole("button", { name: "Save" }).click();

  // 2. Pair, pick the session and preview the exact message.
  await panel.getByRole("button", { name: "Pair with helper" }).click();
  await panel.getByRole("textbox", { name: "Pairing code" }).fill(helper.pairingCode);
  await panel.getByRole("spinbutton", { name: "Helper port" }).fill(String(helper.port));
  await panel.getByRole("button", { name: "Pair", exact: true }).click();
  await panel.getByRole("radio", { name: /northwind-web/ }).check();
  await panel.getByRole("button", { name: "Send pin 1" }).click();
  const dialog = page.getByRole("dialog", { name: "Message preview" });
  await expect(dialog).toBeVisible();
  await shoot(page, "2-preview-then-send.png");

  // 3. Send it; Claude replies with a pull request.
  await dialog.getByRole("button", { name: "Send to claude@northwind-web" }).click();
  const line = JSON.parse(await helper.received(SESSION.pid)) as { message: { content: string } };
  await helper.appendTranscript(SESSION.pid, [
    {
      type: "user",
      isMeta: true,
      origin: { kind: "peer", name: "squashflow", body: line.message.content },
      message: { role: "user", content: line.message.content },
    },
    {
      type: "assistant",
      message: {
        id: "msg_store",
        role: "assistant",
        content: [
          {
            type: "text",
            text: [
              "Gave the Pro card a violet border and a “Most popular” badge.",
              "",
              `SQUASHFLOW-FIXED [${pinIdOf(line.message.content)}] https://github.com/northwind/notes-web/pull/42`,
            ].join("\n"),
          },
        ],
      },
    },
    { type: "system", subtype: "turn_duration", durationMs: 1000 },
  ]);
  await expect(panel.getByText("Fixed", { exact: true })).toBeVisible();
  await shoot(page, "3-fixed-with-pull-request.png");
});

function pinIdOf(message: string): string {
  return /\[(sf-[0-9a-f]{12})\]/.exec(message)?.[1] ?? "";
}
