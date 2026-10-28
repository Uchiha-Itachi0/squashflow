/** Matching a page's repository to the running sessions working on it. */

import type { PublicSession } from "@squashflow/shared";

export interface SessionMatch {
  /** The sessions on the page's repository, in the helper's order. */
  matching: PublicSession[];
  /** Preselected only when exactly one session matches. */
  preselectedPid: number | null;
}

/**
 * Sessions whose repository is the page's. GitHub names are case-insensitive, so
 * the comparison is too. With no known repository nothing matches and the user picks.
 */
export function matchSessions(
  sessions: readonly PublicSession[],
  repo: string | null,
): SessionMatch {
  if (repo === null) return { matching: [], preselectedPid: null };
  const wanted = repo.toLowerCase();
  const matching = sessions.filter((session) => session.repo?.toLowerCase() === wanted);
  const [only] = matching;
  return { matching, preselectedPid: matching.length === 1 && only ? only.pid : null };
}
