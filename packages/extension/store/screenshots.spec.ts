/**
 * The Chrome Web Store screenshots, taken of the real built extension on the local demo
 * page (`e2e/fixture/store.html`), paired with the real helper running against a fake
 * Claude Code session. Each shot is the page with the side panel beside it, as Chrome
 * shows them: the page and the panel are captured separately and set side by side.
 * Writes 1280×800 PNGs to store/screenshots/.
 *
 * Build first, then: pnpm --filter @squashflow/extension store:screenshots
 */

import { expect, test, type Page } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchExtension, pair, type ExtensionHarness } from "../e2e/harness";
import { startHelper, type RunningHelper } from "../e2e/helper-harness";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "screenshots");
const SIZE = { width: 1280, height: 800 };
const PANEL_WIDTH = 400;
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

/** The page and the panel side by side, as one 1280×800 image. */
async function shoot(page: Page, panel: Page, name: string): Promise<void> {
  await page.mouse.move(SIZE.width - PANEL_WIDTH - 1, SIZE.height - 1);
  const left = (await page.screenshot()).toString("base64");
  const right = (await panel.screenshot()).toString("base64");
  const frame = await harness.context.newPage();
  await frame.setViewportSize(SIZE);
  await frame.setContent(
    `<body style="margin:0;display:flex;background:#fff">
      <img src="data:image/png;base64,${left}" style="width:${SIZE.width - PANEL_WIDTH}px;height:${SIZE.height}px">
      <img src="data:image/png;base64,${right}" style="width:${PANEL_WIDTH}px;height:${SIZE.height}px;border-left:1px solid rgba(21,21,26,.12);box-sizing:border-box">
    </body>`,
  );
  await frame.screenshot({ path: join(OUT, name) });
  await frame.close();
}

test("store screenshots", async () => {
  const panel = await harness.openPanel();
  await panel.setViewportSize({ width: PANEL_WIDTH, height: SIZE.height });
  const page = await harness.context.newPage();
  await page.setViewportSize({ width: SIZE.width - PANEL_WIDTH, height: SIZE.height });
  await page.goto(`${harness.origin}/store`);
  await harness.startPinMode(page);

  // Pair and pick the session first, so the toolbar shows where pins go.
  await pair(panel, helper.pairingCode, helper.port);
  await panel.getByRole("radio", { name: /northwind-web/ }).check();
  await panel.getByRole("button", { name: "Use northwind-web" }).click();

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
  await shoot(page, panel, "1-pin-an-area.png");
  await page.getByRole("button", { name: "Save pin" }).click();

  // 2. Go, and preview the exact message.
  await page.getByRole("button", { name: "Go · send 1" }).click();
  const dialog = panel.getByRole("dialog", { name: "Message preview" });
  await expect(dialog).toBeVisible();
  await shoot(page, panel, "2-preview-then-send.png");

  // 3. Send it; Claude replies with a pull request, and the pin's thread shows it all.
  await dialog.getByRole("button", { name: "Send to claude@northwind-web" }).click();
  const line = JSON.parse(await helper.received(SESSION.pid)) as { message: { content: string } };
  await helper.appendTranscript(SESSION.pid, [
    {
      type: "user",
      isMeta: true,
      origin: { kind: "peer", name: "squashflow", body: line.message.content },
      message: { role: "user", content: line.message.content },
    },
  ]);
  await expect(page.locator("squashflow-root .marker").first()).toHaveAttribute(
    "data-status",
    "seen",
  );
  await helper.appendTranscript(SESSION.pid, [
    {
      type: "assistant",
      message: {
        id: "msg_store",
        role: "assistant",
        content: [
          {
            type: "text",
            text: [
              "Gave the Pro card a **violet border** and a “Most popular” badge.",
              "",
              `SQUASHFLOW-FIXED [${pinIdOf(line.message.content)}] https://github.com/northwind/notes-web/pull/42`,
            ].join("\n"),
          },
        ],
      },
    },
    { type: "system", subtype: "turn_duration", durationMs: 1000 },
  ]);
  await expect(page.locator("squashflow-root .marker").first()).toHaveAttribute(
    "data-status",
    "fixed",
  );
  await panel.getByRole("button", { name: "Open pin 1" }).click();
  await expect(panel.getByRole("link", { name: "Pull request" })).toBeVisible();
  await shoot(page, panel, "3-fixed-with-pull-request.png");
});

function pinIdOf(message: string): string {
  return /\[(sf-[0-9a-f]{12})\]/.exec(message)?.[1] ?? "";
}
