/**
 * Reading the fixed line (see github.ts) out of Claude's reply. A pin is Fixed only when
 * the reply carries `SQUASHFLOW-FIXED [<pin id>] <pull request link>` on a line of its
 * own, outside any fenced code block, and the link is a pull request on the repository
 * the session works in. A link anywhere else in the reply, a reply that says the pin was
 * misdirected, or a pull request on another repository never makes a pin Fixed.
 */

import { PULL_REQUEST_URL_PATTERN } from "./api.js";
import { FIXED_MARKER, linesOutsideCodeBlocks } from "./github.js";

const PULL_REQUEST_LINE = new RegExp(`^(${PULL_REQUEST_URL_PATTERN.source})[.)]?$`);

/**
 * The pull request link from the pin's fixed line, or null. `repo` is the session's
 * repository as the helper names it (`owner/name` on GitHub); without one nothing counts,
 * since the link cannot be checked against it. The last valid line wins.
 */
export function findFixedPullRequest(
  text: string,
  pinId: string,
  repo: string | null,
): string | null {
  if (repo === null) return null;
  const prefix = `${FIXED_MARKER} [${pinId}] `;
  let found: string | null = null;
  for (const line of linesOutsideCodeBlocks(text)) {
    if (!line.startsWith(prefix)) continue;
    const url = PULL_REQUEST_LINE.exec(line.slice(prefix.length).trim())?.[1];
    if (url !== undefined && repoOfPullRequest(url) === repo.toLowerCase()) found = url;
  }
  return found;
}

/** `owner/name` of a GitHub pull request link, lower-cased (GitHub names ignore case). */
function repoOfPullRequest(url: string): string {
  const [, , , owner = "", name = ""] = url.split("/");
  return `${owner}/${name}`.toLowerCase();
}
