/**
 * Squish, the squashflow mascot, in the terminal: a small violet kaomoji banner
 * and log prefixes. Colour is dropped for NO_COLOR, --no-color and non-TTY output.
 */

const VIOLET = "\u001b[38;5;141m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

export const SQUISH_FACE = "(｡•ᴗ•｡)";
export const SQUISH_HAPPY = "(｡>ᴗ<｡)";
export const SQUISH_WORRIED = "(｡•﹏•｡)";

export interface Terminal {
  readonly color: boolean;
  banner(subtitle?: string): string;
  info(text: string): string;
  arrow(text: string): string;
  squashed(text?: string): string;
  warn(text: string): string;
  dim(text: string): string;
}

export interface ColorOptions {
  noColorFlag?: boolean;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
}

export function shouldUseColor({
  noColorFlag = false,
  env = process.env,
  isTTY = process.stdout.isTTY,
}: ColorOptions = {}): boolean {
  if (noColorFlag) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  return isTTY;
}

export function createTerminal(color: boolean): Terminal {
  const violet = (text: string): string => (color ? `${VIOLET}${text}${RESET}` : text);
  const dim = (text: string): string => (color ? `${DIM}${text}${RESET}` : text);
  return {
    color,
    banner: (subtitle = "squashflow helper") => `${violet(`${SQUISH_FACE} Squish`)} · ${subtitle}`,
    info: (text) => `${violet("squish ›")} ${text}`,
    arrow: (text) => `${violet("squish →")} ${text}`,
    squashed: (text = "squashed!") => violet(`${SQUISH_HAPPY} ${text}`),
    warn: (text) => `${violet(`squish ${SQUISH_WORRIED}`)} ${text}`,
    dim,
  };
}
