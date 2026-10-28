/** Fixed values the helper relies on. Documented in docs/architecture.md. */

import packageJson from "../package.json" with { type: "json" };

/** The version lives only in package.json; the build bundles it in. */
export const HELPER_VERSION: string = packageJson.version;

/** The only address the helper ever binds. */
export const LOOPBACK_HOST = "127.0.0.1";
export { DEFAULT_HELPER_PORT as DEFAULT_PORT } from "@squashflow/shared";

/** Request bodies above this many bytes are rejected before they are read in full. */
export const MAX_BODY_BYTES = 64 * 1024;
/**
 * `POST /pins` bodies may carry a region screenshot per pin, so their cap fits the most
 * pins in one message, each with the largest screenshot (base64), plus their context.
 */
export const MAX_PINS_BODY_BYTES = 16 * 1024 * 1024;

/** Delivered messages' screenshot files are removed this long after delivery. */
export const SCREENSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const PAIRING_CODE_LENGTH = 8;
export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
export const PAIRING_MAX_ATTEMPTS = 5;
export const PAIRING_TOKEN_BYTES = 32;

/**
 * Oldest Claude Code release with the session inbox socket and the
 * `claude agents --json` fields the helper reads (pid, cwd, name, status, sessionId).
 */
export const MIN_CLAUDE_CODE_VERSION = "2.1.224";

/** Where Claude Code sessions bind their inbox sockets: `<dir>/<pid>.sock`. */
export const DEFAULT_INBOX_SOCKET_DIR = "/tmp/cc-socks";

/** The sender name sessions show for Squashflow messages ("Message from @squashflow"). */
export const SENDER_NAME = "squashflow";

export const TRANSCRIPT_POLL_MS = 400;
/**
 * Stop following a pin's transcript after this long with no new transcript lines (session
 * gone, held message rejected). A pin still Sent or Approve in terminal then becomes Blocked.
 */
export const TRANSCRIPT_WATCH_MAX_MS = 30 * 60 * 1000;
export const COMMAND_TIMEOUT_MS = 15_000;
