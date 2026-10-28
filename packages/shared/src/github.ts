/**
 * The GitHub flow's text contract with the session: what the message asks for, the
 * machine-readable lines a session replies with when it opened the pull request (fixed)
 * or lacks GitHub access (blocked), and the follow-up messages the user can send from a
 * pin that is Blocked: GitHub access.
 *
 * Claude's reply is untrusted text, so a marker line is only believed when it names
 * the pin's own id, which is random and created after the page context was captured:
 * page content quoted in a reply cannot carry it. The line must also stand alone at
 * the start of a line outside any fenced code block. The fixed line is read in fixed.ts.
 */

/** The word that starts the fixed line. */
export const FIXED_MARKER = "SQUASHFLOW-FIXED";
/** The word that starts the blocked line. */
export const BLOCKED_MARKER = "SQUASHFLOW-BLOCKED";
/** The only kind of block a session reports today. */
export const GITHUB_ACCESS = "github-access";
/** Placeholder shown in the instructions; a reply that repeats it is not a real report. */
const REASON_PLACEHOLDER = "<one-line reason>";
/** Longest reason kept from a blocked line. */
export const MAX_BLOCKED_REASON_CHARS = 300;

export const FOLLOW_UP_ACTIONS = ["retry", "fork", "patch"] as const;
export type FollowUpAction = (typeof FOLLOW_UP_ACTIONS)[number];

/** Placeholder shown in the instructions; a reply that repeats it is not a real report. */
const LINK_PLACEHOLDER = "<pull request link>";

/** The fixed line for a pin, as a session should write it. */
export function fixedLine(pinId: string, pullRequestUrl: string = LINK_PLACEHOLDER): string {
  return `${FIXED_MARKER} [${pinId}] ${pullRequestUrl}`;
}

/** The blocked line for a pin, as a session should write it. */
export function blockedLine(pinId: string, reason: string = REASON_PLACEHOLDER): string {
  return `${BLOCKED_MARKER} [${pinId}] ${GITHUB_ACCESS}: ${reason}`;
}

/** The requested outcome: the GitHub flow, and how to report a lack of access. */
export function requestedOutcome(pinId: string, plural: boolean): string {
  return [
    "Requested outcome:",
    `Fix ${plural ? "these" : "this"} in this repository, then, using the user's own \`git\` and \`gh\` login:`,
    "1. Create a new branch, commit the change, and push the branch.",
    "2. Open a pull request with `gh pr create`.",
    "3. Reply with a short summary and the fixed line below.",
    "",
    fixedInstructions(pinId),
    "",
    githubAccessInstructions(pinId),
  ].join("\n");
}

/**
 * How a session reports the pull request it opened for this pin. Only this line marks the
 * pin Fixed; a link anywhere else in the reply does not.
 */
function fixedInstructions(pinId: string): string {
  return [
    "Once the pull request is open, put this line on its own, outside any code block, with the pull request's link:",
    fixedLine(pinId),
    "Write it only for a pull request you opened for this pin. If you did not fix it (for example the pin is not about this repository), say so and leave the line out.",
  ].join("\n");
}

/**
 * The block report shared by the first message and every follow-up. Kept as one
 * sentence set so a session gets the same contract each time.
 */
function githubAccessInstructions(pinId: string): string {
  return [
    "If the push or the pull request fails because the user lacks access (not logged in to `gh`, no push permission, the repository is protected), do not retry or work around it.",
    "Keep the commit on its branch, and reply with this line on its own, outside any code block, followed by a short summary of the change:",
    blockedLine(pinId),
  ].join("\n");
}

/**
 * A follow-up to a pin that is Blocked: GitHub access. Fixed text per action: nothing
 * from the page or the reply goes into it, so the user previews only Squashflow's words.
 */
export function buildFollowUp(pinId: string, action: FollowUpAction): string {
  return [
    `Squashflow follow-up on pin [${pinId}] from the user's browser, delivered by the local Squashflow helper.`,
    "It was not typed in this terminal. It continues the earlier Squashflow message with the same pin id.",
    "",
    FOLLOW_UP_REQUESTS[action],
    "",
    action === "patch"
      ? "Do not push, fork or open a pull request for this request."
      : [fixedInstructions(pinId), "", githubAccessInstructions(pinId)].join("\n"),
  ].join("\n");
}

const FOLLOW_UP_REQUESTS: Record<FollowUpAction, string> = {
  retry: [
    "The user has run `gh auth login`. Push the branch for this pin again and open the pull request with `gh pr create`.",
    "Reply with a short summary and the fixed line below.",
  ].join("\n"),
  fork: [
    "The user cannot push to this repository. Fork it with `gh repo fork --remote --remote-name squashflow-fork`, push the branch for this pin to the fork,",
    "and open the pull request from the fork against the original repository with `gh pr create`.",
    "Reply with a short summary and the fixed line below.",
  ].join("\n"),
  patch: [
    "Reply with the change for this pin as one unified diff against the branch it started from (for example `git diff <base>...HEAD`),",
    "in a single ```diff code block, after one line summarising the change.",
  ].join("\n"),
};

export interface BlockedReport {
  reason: string;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** The lines of a reply that are outside fenced code blocks; an unclosed fence hides the rest. */
export function linesOutsideCodeBlocks(text: string): string[] {
  let fence: string | null = null;
  const kept: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const opener = FENCE.exec(line)?.[1];
    if (opener !== undefined) {
      if (fence === null) fence = opener;
      else if (opener[0] === fence[0] && opener.length >= fence.length) fence = null;
      continue;
    }
    if (fence === null) kept.push(line);
  }
  return kept;
}

/**
 * Find the blocked line for `pinId` in a reply. Lines inside fenced code blocks, lines
 * that do not start with the marker (quoted, indented, prefixed), other pins' ids, other
 * kinds, and missing or placeholder reasons do not count. The last valid line wins.
 */
export function findBlockedReport(text: string, pinId: string): BlockedReport | null {
  const prefix = `${BLOCKED_MARKER} [${pinId}] ${GITHUB_ACCESS}:`;
  let found: BlockedReport | null = null;
  for (const line of linesOutsideCodeBlocks(text)) {
    if (!line.startsWith(prefix)) continue;
    const reason = cleanReason(line.slice(prefix.length));
    if (reason !== null) found = { reason };
  }
  return found;
}

function cleanReason(raw: string): string | null {
  // eslint-disable-next-line no-control-regex
  const reason = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (reason === "" || reason === REASON_PLACEHOLDER) return null;
  return reason.slice(0, MAX_BLOCKED_REASON_CHARS);
}
