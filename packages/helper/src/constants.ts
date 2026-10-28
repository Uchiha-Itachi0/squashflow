/** Fixed values the helper relies on. Documented in docs/architecture.md. */

export const HELPER_VERSION = "0.1.0";

/** The only address the helper ever binds. */
export const LOOPBACK_HOST = "127.0.0.1";
export { DEFAULT_HELPER_PORT as DEFAULT_PORT } from "@squashflow/shared";

/** Request bodies above this many bytes are rejected before they are read in full. */
export const MAX_BODY_BYTES = 64 * 1024;

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
