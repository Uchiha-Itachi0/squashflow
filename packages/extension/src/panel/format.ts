/** Small text helpers for the side panel. */

import type { PublicSession } from "@squashflow/shared";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "started 3h ago · active 2m ago", from what the helper knows; empty when it knows neither. */
export function sessionTimes(session: PublicSession, now: number): string {
  const started = timeAgo(session.startedAt, now);
  const active = timeAgo(session.lastActiveAt, now);
  return [started && `started ${started}`, active && `active ${active}`]
    .filter(Boolean)
    .join(" · ");
}

/** "just now", "5m ago", "3h ago", "2d ago"; empty when the time is unknown. */
export function timeAgo(iso: string | number | null, now: number): string {
  if (iso === null) return "";
  const at = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  return `${Math.floor(elapsed / DAY_MS)}d ago`;
}

/** "10:42", in the browser's locale. */
export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** A page URL without its scheme: `localhost:3000/pricing`. */
export function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

/** "PR #48" from a pull request link. */
export function pullRequestLabel(url: string): string {
  const number = /\/pull\/([0-9]+)/.exec(url)?.[1];
  return number === undefined ? "Pull request" : `PR #${number}`;
}

/** The folder with the home directory shortened: `~/code/acme-web`. */
export function shortPath(cwd: string): string {
  return cwd.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}
