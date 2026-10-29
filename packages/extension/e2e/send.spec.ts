/**
 * The side panel end to end: pair with the real helper, pick a session in the sheet, pin
 * on the fixture page, send it from the inbox, confirm the previewed message, and follow
 * the pin's chat from Sent to Seen to Claude's reply to Fixed, then send a follow-up
 * through the same preview-then-confirm. The helper runs against a fake `claude`, fake inbox sockets and a
 * fake transcript; the test checks that each inbox received exactly what was previewed.
 */

import { expect, test, type Page } from "@playwright/test";
import { launchExtension, pair, pinElement, type ExtensionHarness } from "./harness";
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

/** Claude Code records the delivered message in the session transcript. */
async function seen(content: string): Promise<void> {
  await helper.appendTranscript(DEMO.pid, [
    {
      type: "user",
      isMeta: true,
      origin: { kind: "peer", name: "squashflow", body: content },
      message: { role: "user", content },
    },
  ]);
}

async function replies(id: string, text: string): Promise<void> {
  await helper.appendTranscript(DEMO.pid, [
    { type: "assistant", message: { id, role: "assistant", content: [{ type: "text", text }] } },
    { type: "system", subtype: "turn_duration", durationMs: 1000 },
  ]);
}

async function conversation(panel: Page): Promise<string[]> {
  const items = panel.getByRole("log", { name: "Conversation for pin 1" }).locator(".convo > li");
  return items.allInnerTexts();
}

test("pair, pick a session, pin, send, and follow the pin's chat", async () => {
  const panel = await harness.openPanel();
  const page = await harness.context.newPage();
  await page.goto(`${harness.origin}/`);
  await expect(panel.getByRole("button", { name: "Start pinning on this page" })).toBeVisible();
  await harness.startPinMode(page);

  // Not connected yet: the inbox asks to connect; the page toolbar has only pin tools.
  await expect(
    panel.getByRole("heading", { name: "Click anything on the page. Claude fixes it." }),
  ).toBeVisible();
  await expect(panel.getByText("Not connected")).toBeVisible();
  const toolbar = page.getByRole("toolbar", { name: "Squashflow toolbar" });
  await expect(toolbar.getByRole("button")).toHaveText(["Element", "Text", "Area", "Multi", ""]);

  await pair(panel, "WRONG-CODE", helper.port);
  await expect(panel.getByRole("status")).toHaveText(/pairing code is wrong/);
  await pair(panel, helper.pairingCode, helper.port);
  await expect(panel.getByText("Connected. Now pick who fixes this site.")).toBeVisible();

  // Two sessions and no site mapping: nothing is preselected, so the session sheet opens.
  const sheet = panel.getByRole("dialog", { name: "Who fixes this site" });
  const demo = sheet.getByRole("radio", { name: /e2e-demo/ });
  await expect(demo).not.toBeChecked();
  await expect(sheet.getByRole("radio", { name: /e2e-other/ })).not.toBeChecked();
  // Each card: its name (no title yet, so its folder), where it works, and whether it is free.
  const demoCard = sheet.locator("label.ses", {
    has: panel.getByRole("radio", { name: /e2e-demo/ }),
  });
  await expect(demoCard.locator(".name b")).toHaveText("e2e-demo");
  await expect(demoCard.locator(".where")).toHaveText(/^acme\/demo/);
  await expect(demoCard.locator(".state")).toHaveText(/^Ready/);
  await expect(sheet.getByText(/^Busy\. Reads pins between steps\./)).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Choose a session" })).toBeDisabled();
  await demo.check();
  await sheet.getByRole("checkbox", { name: /Remember: this site's code is acme\/demo/ }).check();
  await expect(demoCard.getByText("This site", { exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Use e2e-demo" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(panel.getByText("e2e-demo will fix this site.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Who fixes this site: e2e-demo" })).toBeVisible();

  // Collecting is the default: the pin waits in Ready to send.
  await pinElement(page, "#buy", "Make the Buy button violet");
  expect(await page.evaluate(() => (window as unknown as { buyClicks: number }).buyClicks)).toBe(0);
  const ready = panel.getByRole("region", { name: "Ready to send" });
  await expect(ready.getByRole("button", { name: "Open pin 1" })).toContainText(
    "Make the Buy button violet",
  );
  const marker = page.locator("squashflow-root .marker").first();
  await expect(marker).not.toHaveAttribute("data-status");
  await panel.getByRole("button", { name: "Send 1 pin to Claude" }).click();

  const dialog = panel.getByRole("dialog", { name: "Message preview" });
  await expect(dialog).toBeVisible();
  const previewed = await dialog.locator("pre").innerText();
  expect(previewed).toMatch(/^Squashflow pin \[sf-[0-9a-f]{12}\] from the user's browser/);
  expect(previewed).toContain("Make the Buy button violet");
  expect(previewed).not.toContain("hunter2-secret");
  expect(helper.inboxLines(DEMO.pid)).toHaveLength(0);

  await dialog.getByRole("button", { name: "Send 1 pin to Claude" }).click();
  await expect(panel.getByRole("status")).toHaveText("Sent 1 pin to e2e-demo.");
  await expect(dialog).toHaveCount(0);
  const line = JSON.parse(await helper.received(DEMO.pid)) as {
    type: string;
    message: { content: string };
  };
  expect(line.type).toBe("user");
  expect(line.message.content).toContain(`\n${previewed}\n</cross-session-message>`);
  expect(helper.inboxLines(OTHER.pid)).toHaveLength(0);
  await expect(marker).toHaveAttribute("data-status", "sent");
  await expect(
    panel.getByRole("region", { name: "Claude is on it" }).getByRole("button", {
      name: "Open pin 1",
    }),
  ).toBeVisible();

  // Open the pin: one chat, the comment first, then what happened.
  await panel.getByRole("button", { name: "Open pin 1" }).click();
  await expect(panel.getByLabel("Your pin")).toHaveText("Make the Buy button violet");
  await expect
    .poll(() => conversation(panel))
    .toEqual([expect.stringMatching(/^Sent to e2e-demo/)]);

  await seen(line.message.content);
  await expect(marker).toHaveAttribute("data-status", "seen");
  await expect
    .poll(() => conversation(panel))
    .toEqual([
      expect.stringMatching(/^Sent to e2e-demo/),
      expect.stringMatching(/^Seen by Claude/),
    ]);

  // Claude replies with the pin's fixed line. The markdown renders, its markup never does.
  const pinId = /\[(sf-[0-9a-f]{12})\]/.exec(previewed)?.[1] ?? "";
  await replies(
    "msg_e2e",
    [
      "Made the **Buy** button violet. <img src=x onerror=alert(1)>",
      "",
      `SQUASHFLOW-FIXED [${pinId}] https://github.com/acme/demo/pull/5`,
    ].join("\n"),
  );
  await expect(marker).toHaveAttribute("data-status", "fixed");
  await expect
    .poll(() => conversation(panel))
    .toEqual([
      expect.stringMatching(/^Sent to e2e-demo/),
      expect.stringMatching(/^Seen by Claude/),
      expect.stringMatching(/Made the Buy button violet\. <img src=x onerror=alert\(1\)>/),
      expect.stringMatching(/^Fixed/),
    ]);
  const reply = panel.getByLabel("Claude's reply").first();
  await expect(reply.locator("strong")).toHaveText("Buy");
  expect(await panel.locator("img[src='x']").count()).toBe(0);
  await expect(panel.getByRole("link", { name: "Pull request" })).toHaveAttribute(
    "href",
    "https://github.com/acme/demo/pull/5",
  );

  // What was pinned stays behind Details.
  await expect(panel.getByRole("region", { name: "Details" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Details" }).click();
  await expect(panel.getByRole("region", { name: "Details" })).toContainText("#buy");

  // A follow-up goes to the same session, previewed first.
  await panel.getByRole("textbox", { name: "Reply to Claude" }).fill("Make it a bit darker");
  await panel.getByRole("button", { name: "Preview reply" }).click();
  const followUp = await dialog.locator("pre").innerText();
  expect(followUp).toContain(`Follow-up to Squashflow pin [${pinId}]`);
  expect(followUp).toContain("Make it a bit darker");
  expect(helper.inboxLines(DEMO.pid)).toHaveLength(1);
  await dialog.getByRole("button", { name: "Send reply to Claude" }).click();
  await expect(panel.getByRole("status")).toHaveText("Sent your reply to e2e-demo.");
  await expect.poll(() => helper.inboxLines(DEMO.pid).length).toBe(2);
  const delivered = JSON.parse(helper.inboxLines(DEMO.pid)[1] ?? "{}") as {
    message: { content: string };
  };
  expect(delivered.message.content).toContain(`\n${followUp}\n</cross-session-message>`);
  await expect(panel.getByLabel("Your reply")).toHaveText("Make it a bit darker");
  await expect.poll(async () => (await conversation(panel)).at(-1)).toMatch(/^Sent to e2e-demo/);
  // The earlier reply stays in the chat.
  await expect(reply).toBeVisible();

  await panel.getByRole("button", { name: "Mark done pin 1" }).click();
  await expect(marker).toHaveAttribute("data-status", "resolved");
  await panel.getByRole("button", { name: "Reopen pin 1" }).click();
  await expect(marker).toHaveAttribute("data-status", "sent");

  // The token never lands in storage the pin mode script can read.
  const worker = await harness.worker();
  const stored = await worker.evaluate(() => chrome.storage.local.get(null));
  expect(Object.keys(stored).sort()).toEqual([
    "pin-status",
    `pins:${harness.origin}/`,
    "settings",
    "site-repos",
  ]);
  expect(JSON.stringify(stored)).not.toMatch(/token/i);
  expect(stored["site-repos"]).toEqual({ [harness.origin]: "acme/demo" });

  // The remembered site preselects its only matching session next time.
  await page.reload();
  await harness.startPinMode(page);
  await expect(panel.getByRole("button", { name: "Who fixes this site: e2e-demo" })).toBeVisible();

  await panel.getByRole("button", { name: "Settings" }).click();
  await panel.getByRole("button", { name: "Disconnect" }).click();
  await panel.getByRole("button", { name: "Back to all pins" }).click();
  await expect(panel.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
});
