/**
 * Helper failures in plain words. Every call to the helper ends in a value or one of
 * these; the kind tells the UI what to do next (pair again, start the helper, preview
 * again), and the message is what the user reads.
 */

export type HelperFailureKind =
  /** The helper is not running, or not on that port. */
  | "unreachable"
  /** No token, or the helper no longer accepts it. */
  | "unpaired"
  /** The previewed message is gone or no longer matches; preview again. */
  | "expired"
  /** The chosen session is no longer running. */
  | "gone"
  /** Any other refusal; the message says why. */
  | "rejected";

export interface HelperFailure {
  kind: HelperFailureKind;
  message: string;
}

export type HelperResult<T> = { ok: true; value: T } | { ok: false; failure: HelperFailure };

export const UNREACHABLE: HelperFailure = {
  kind: "unreachable",
  message: "The helper is not running. Start it with `npx squashflow`, or copy the pins instead.",
};

export const NOT_PAIRED: HelperFailure = {
  kind: "unpaired",
  message: "Not paired with the helper. Enter the code `npx squashflow` prints.",
};

const PAIR_AGAIN: HelperFailure = {
  kind: "unpaired",
  message: "The helper no longer accepts this browser. Pair again with a new code.",
};

const PAIRING_FAILURES: Record<number, string> = {
  401: "That pairing code is wrong. Check the code in the helper's terminal.",
  409: "The helper has no pairing code active. Press Enter in its terminal for a new one.",
  410: "That pairing code expired. Press Enter in the helper's terminal for a new one.",
  429: "Too many wrong codes. Press Enter in the helper's terminal for a new one.",
};

/** A failed `POST /pair`, by status. */
export function pairingFailure(status: number, helperError: string | undefined): HelperFailure {
  const message = PAIRING_FAILURES[status];
  if (message !== undefined) return { kind: "rejected", message };
  return apiFailure(status, helperError);
}

/** A failed call to any endpoint other than pairing, by status and the helper's own words. */
export function apiFailure(status: number, helperError: string | undefined): HelperFailure {
  if (status === 401 || status === 403) return PAIR_AGAIN;
  if (status === 404) {
    return {
      kind: "gone",
      message: "That Claude Code session is no longer running. Refresh the sessions.",
    };
  }
  if (status === 409 && helperError !== undefined && /preview/i.test(helperError)) {
    return {
      kind: "expired",
      message: "The preview expired or no longer matches. Preview the message again.",
    };
  }
  if (status === 413) {
    return {
      kind: "rejected",
      message: "These pins are too large for one message. Send fewer pins, or copy them instead.",
    };
  }
  if (helperError !== undefined && helperError !== "") {
    return { kind: "rejected", message: sentence(helperError) };
  }
  return { kind: "rejected", message: `The helper refused the request (status ${status}).` };
}

export const INVALID_RESPONSE: HelperFailure = {
  kind: "rejected",
  message: "The helper sent an answer this extension does not understand. Update both.",
};

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
