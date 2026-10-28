/**
 * Pair the built extension with the real helper, pick a session, preview the message
 * and send it, then follow it to Claude's reply. The helper runs against a fake `claude`,
 * fake inbox sockets and a fake transcript; the test checks that the inbox received
 * exactly the message that was previewed, and that the reply written to the transcript
 * reaches the pin as plain text with its pull request link.
 */

import { expect, test } from "@playwright/test";
import { launchExtension, pinElement, type ExtensionHarness } from "./harness";
import { startHelper, type RunningHelper } from "./helper-harness";

const DEMO = {
  pid: 4242,
  name: "e2e-demo",
  status: "idle",
  remote: "git@github.com:acme/demo.git",
} as const;
const OTHER = {
  pid: 4343,
  name: "e2e-other",
  status: "busy",
  remote: "https://github.com/acme/other.git",
} as const;

let harness: ExtensionHarness;
let helper: RunningHelper;

test.beforeAll(async () => {
  helper = await startHelper([DEMO, OTHER]);
  harness = await launchExtension();
});

test.afterAll(async () => {
  await harness.close();
  await helper.close();
});

test("pair, pick a session, preview and send a pin", async () => {
  const page = await harness.context.newPage();
  await page.goto(`${harness.origin}/`);
  await harness.togglePinMode(page);
  const panel = page.getByRole("region", { name: "Squashflow pins" });
  await pinElement(page, "#buy", "Make the Buy button violet");

  // Not paired yet: copy is the only way out, and no Send buttons are offered.
  await expect(panel.getByText("Not paired")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Send pin 1" })).toHaveCount(0);

  await panel.getByRole("button", { name: "Pair with helper" }).click();
  await panel.getByRole("textbox", { name: "Pairing code" }).fill("WRONG-CODE");
  await panel.getByRole("spinbutton", { name: "Helper port" }).fill(String(helper.port));
  await panel.getByRole("button", { name: "Pair", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText(/pairing code is wrong/);

  await panel.getByRole("textbox", { name: "Pairing code" }).fill(helper.pairingCode);
  await panel.getByRole("button", { name: "Pair", exact: true }).click();
  await expect(panel.getByText("Paired", { exact: true })).toBeVisible();

  // Two sessions, no site mapping yet: nothing is preselected.
  const demo = panel.getByRole("radio", { name: /e2e-demo/ });
  const other = panel.getByRole("radio", { name: /e2e-other/ });
  await expect(demo).not.toBeChecked();
  await expect(other).not.toBeChecked();
  // Each session shows its repository with the branch checked out there.
  await expect(panel.getByText(/^acme\/demo · \S+$/)).toBeVisible();
  await expect(panel.getByText("busy", { exact: true })).toBeVisible();

  await demo.check();
  await panel.getByRole("checkbox", { name: /Remember: this site's code is acme\/demo/ }).check();
  await expect(panel.getByText("this site", { exact: true })).toBeVisible();

  await panel.getByRole("button", { name: "Send pin 1" }).click();
  const dialog = page.getByRole("dialog", { name: "Message preview" });
  await expect(dialog).toBeVisible();
  const previewed = await dialog.locator("pre").innerText();
  expect(previewed).toMatch(/^Squashflow pin \[sf-[0-9a-f]{12}\] from the user's browser/);
  expect(previewed).toContain("Make the Buy button violet");
  expect(previewed).not.toContain("hunter2-secret");
  expect(helper.inboxLines(DEMO.pid)).toHaveLength(0);

  await dialog.getByRole("button", { name: "Send to claude@e2e-demo" }).click();
  await expect(panel.getByRole("status")).toHaveText("Sent 1 pin to claude@e2e-demo.");
  await expect(dialog).toHaveCount(0);

  const line = JSON.parse(await helper.received(DEMO.pid)) as {
    type: string;
    message: { content: string };
  };
  expect(line.type).toBe("user");
  expect(line.message.content).toContain(`\n${previewed}\n</cross-session-message>`);
  expect(helper.inboxLines(OTHER.pid)).toHaveLength(0);
  const row = panel.locator("li", { hasText: "Make the Buy button violet" });
  const marker = page.locator("squashflow-root .marker").first();
  await expect(row.getByText("Sent", { exact: true })).toBeVisible();
  await expect(marker).toHaveAttribute("data-status", "sent");

  // Claude Code records the message, then replies with the pin's fixed line. The reply's
  // markdown is rendered, its markup never is.
  const pinId = /\[(sf-[0-9a-f]{12})\]/.exec(previewed)?.[1] ?? "";
  const replyText = [
    "Made the **Buy** button violet. <img src=x onerror=alert(1)>",
    "",
    `SQUASHFLOW-FIXED [${pinId}] https://github.com/acme/demo/pull/5`,
  ].join("\n");
  await helper.appendTranscript(DEMO.pid, [
    {
      type: "user",
      isMeta: true,
      origin: { kind: "peer", name: "squashflow", body: line.message.content },
      message: { role: "user", content: line.message.content },
    },
  ]);
  await expect(row.getByText("Seen by Claude", { exact: true })).toBeVisible();
  await expect(marker).toHaveAttribute("data-status", "seen");
  await helper.appendTranscript(DEMO.pid, [
    {
      type: "assistant",
      message: { id: "msg_e2e", role: "assistant", content: [{ type: "text", text: replyText }] },
    },
    { type: "system", subtype: "turn_duration", durationMs: 1000 },
  ]);
  await expect(row.getByText("Fixed", { exact: true })).toBeVisible();
  await expect(marker).toHaveAttribute("data-status", "fixed");
  const reply = row.getByLabel("Claude's reply to pin 1");
  await expect(reply).toContainText("Made the Buy button violet. <img src=x onerror=alert(1)>");
  await expect(reply.locator("strong")).toHaveText("Buy");
  await expect(row.getByRole("link", { name: "Pull request for pin 1" })).toHaveAttribute(
    "href",
    "https://github.com/acme/demo/pull/5",
  );
  // The reply's own markup is shown as text, never parsed.
  expect(
    await page
      .locator("squashflow-root")
      .evaluate((host) => host.shadowRoot?.querySelectorAll("img").length),
  ).toBe(0);

  await row.getByRole("button", { name: "Resolve pin 1" }).click();
  await expect(row.getByText("Resolved", { exact: true })).toBeVisible();
  await expect(marker).toHaveAttribute("data-status", "resolved");
  await row.getByRole("button", { name: "Reopen pin 1" }).click();
  await expect(row.getByText("Fixed", { exact: true })).toBeVisible();

  // The token never lands in storage the pin mode script can read.
  const worker = await harness.worker();
  const stored = await worker.evaluate(() => chrome.storage.local.get(null));
  expect(Object.keys(stored).sort()).toEqual([
    "pin-status",
    `pins:${harness.origin}/`,
    "site-repos",
  ]);
  expect(stored["site-repos"]).toEqual({ [harness.origin]: "acme/demo" });

  // The remembered site preselects its only matching session next time.
  await page.reload();
  await harness.togglePinMode(page);
  await expect(panel.getByRole("radio", { name: /e2e-demo/ })).toBeChecked();
  await expect(panel.getByRole("button", { name: "Send pin 1" })).toBeVisible();

  await panel.getByRole("button", { name: "Forget", exact: true }).click();
  await expect(panel.getByText("Not paired")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Copy all" })).toBeEnabled();
});
