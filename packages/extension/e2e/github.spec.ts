/**
 * The GitHub flow: a pin whose session replies that it lacks GitHub access moves to
 * Blocked: GitHub access, and its thread in the side panel offers four ways out. Copy
 * the patch and Ask the owner copy to the clipboard; Log in shows `gh auth login` and a
 * Retry, whose follow-up reaches the fake inbox only after the user confirms the
 * previewed message. The helper runs against
 * a fake `claude`, fake inbox sockets and a fake transcript, as in the send test.
 */

import { expect, test, type Page } from "@playwright/test";
import { launchExtension, pair, pinElement, type ExtensionHarness } from "./harness";
import { startHelper, type RunningHelper } from "./helper-harness";

const DEMO = {
  pid: 4545,
  name: "e2e-github",
  status: "idle",
  remote: "git@github.com:acme/demo.git",
} as const;

const PATCH = [
  "diff --git a/index.html b/index.html",
  "--- a/index.html",
  "+++ b/index.html",
  "@@ -1 +1 @@",
  "-<button id=buy>Buy</button>",
  "+<button id=buy class=violet>Buy</button>",
  "",
].join("\n");

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

async function pairAndSend(panel: Page, page: Page): Promise<{ content: string; id: string }> {
  await pair(panel, helper.pairingCode, helper.port);
  await panel.getByRole("radio", { name: /e2e-github/ }).check();
  await panel.getByRole("button", { name: "Use e2e-github" }).click();
  await pinElement(page, "#buy", "Make the Buy button violet");
  await panel.getByRole("button", { name: /^Go · send 1 pin/ }).click();
  const dialog = panel.getByRole("dialog", { name: "Message preview" });
  const previewed = await dialog.locator("pre").innerText();
  expect(previewed).toContain("SQUASHFLOW-BLOCKED [sf-");
  await dialog.getByRole("button", { name: "Send to claude@e2e-github" }).click();
  const line = JSON.parse(await helper.received(DEMO.pid)) as { message: { content: string } };
  const id = /Squashflow pin \[(sf-[0-9a-f]{12})\]/.exec(previewed)?.[1];
  if (id === undefined) throw new Error("No pin id in the preview");
  return { content: line.message.content, id };
}

test("a pin blocked on GitHub access offers four ways out", async () => {
  const panel = await harness.openPanel();
  const page = await harness.context.newPage();
  await page.goto(`${harness.origin}/`);
  await harness.startPinMode(page);
  const { content, id } = await pairAndSend(panel, page);

  // The session handles the pin and replies that the push was refused.
  const reply = [
    "Made the Buy button violet and committed it on squashflow/violet-buy. The push was refused.",
    `SQUASHFLOW-BLOCKED [${id}] github-access: no push permission to acme/demo`,
    "```diff",
    PATCH.trimEnd(),
    "```",
  ].join("\n");
  await helper.appendTranscript(DEMO.pid, [
    {
      type: "user",
      isMeta: true,
      origin: { kind: "peer", name: "squashflow", body: content },
      message: { role: "user", content },
    },
    {
      type: "assistant",
      message: { id: "msg_gh", role: "assistant", content: [{ type: "text", text: reply }] },
    },
    { type: "system", subtype: "turn_duration", durationMs: 1000 },
  ]);

  await expect(page.locator("squashflow-root .marker").first()).toHaveAttribute(
    "data-status",
    "blocked",
  );
  await expect(panel.getByRole("button", { name: "Open pin 1" })).toContainText(
    "Blocked: GitHub access",
  );
  await panel.getByRole("button", { name: "Open pin 1" }).click();
  const options = panel.getByRole("group", { name: "GitHub access" });
  await expect(
    options.getByRole("heading", { name: "Claude made the fix, but can't push it" }),
  ).toBeVisible();
  await expect(options.getByText("no push permission to acme/demo")).toBeVisible();
  for (const name of [
    "Fork and open a PR",
    "Log in with another account",
    "Copy the patch",
    "Ask the owner",
  ]) {
    await expect(options.getByRole("button", { name })).toBeVisible();
  }

  await options.getByRole("button", { name: "Copy the patch" }).click();
  await expect(panel.getByRole("status")).toHaveText("Copied the patch for pin 1.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(PATCH);

  await options.getByRole("button", { name: "Ask the owner" }).click();
  await expect(panel.getByRole("status")).toHaveText(
    "Copied a message for the repository owner about pin 1.",
  );
  const owner = await page.evaluate(() => navigator.clipboard.readText());
  expect(owner).toContain("> Make the Buy button violet");
  expect(owner).toContain("> Made the Buy button violet and committed it");
  expect(owner).not.toContain("SQUASHFLOW-BLOCKED");

  // Log in: the instruction, then Retry previews a follow-up; nothing is sent before confirm.
  await options.getByRole("button", { name: "Log in with another account" }).click();
  await expect(
    options.getByText("Run `gh auth login` in a terminal, then press Retry."),
  ).toBeVisible();
  await options.getByRole("button", { name: "Retry" }).click();
  const dialog = panel.getByRole("dialog", { name: "Message preview" });
  const followUp = await dialog.locator("pre").innerText();
  expect(followUp).toMatch(new RegExp(`^Squashflow follow-up on pin \\[${id}\\]`));
  expect(followUp).toContain("The user has run `gh auth login`.");
  expect(helper.inboxLines(DEMO.pid)).toHaveLength(1);

  // Cancelling sends nothing; Fork previews its own follow-up.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await options.getByRole("button", { name: "Fork and open a PR" }).click();
  await expect(dialog.locator("pre")).toContainText("gh repo fork");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(helper.inboxLines(DEMO.pid)).toHaveLength(1);

  await options.getByRole("button", { name: "Log in with another account" }).click();
  await options.getByRole("button", { name: "Retry" }).click();
  await dialog.getByRole("button", { name: "Send to claude@e2e-github" }).click();
  await expect(panel.getByRole("status")).toHaveText(
    'Sent "Retry after logging in" to claude@e2e-github.',
  );
  await expect.poll(() => helper.inboxLines(DEMO.pid).length).toBe(2);
  const delivered = JSON.parse(helper.inboxLines(DEMO.pid)[1] ?? "{}") as {
    message: { content: string };
  };
  expect(delivered.message.content).toContain(`\n${followUp}\n</cross-session-message>`);
  await expect(page.locator("squashflow-root .marker").first()).toHaveAttribute(
    "data-status",
    "sent",
  );
  await expect(options).toHaveCount(0);

  // The token stays in the service worker: the pin mode script's storage never has it.
  const worker = await harness.worker();
  const stored = JSON.stringify(await worker.evaluate(() => chrome.storage.local.get(null)));
  expect(stored).not.toMatch(/token/i);
});
