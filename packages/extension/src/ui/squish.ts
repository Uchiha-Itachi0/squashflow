/**
 * Squish, the Squashflow mascot, as drawn on the design canvas: a round violet mochi with
 * big dark eyes, pink cheeks, tiny feet and an amber swatter. Its face follows a mood.
 * The markup is a constant per mood; no page or reply text ever goes into it.
 */

export type SquishMood = "waiting" | "working" | "squashed" | "blocked";

const VIOLET = "#6B5BFF";
const INK = "#15151A";

const BODY = `<path d="M28 126c0-50 32-88 72-88s72 38 72 88c0 22-16 38-38 38H66c-22 0-38-16-38-38z" fill="${VIOLET}"/>`;
const CHEEKS =
  '<ellipse cx="56" cy="130" rx="12" ry="7" fill="#FF9EC4"/><ellipse cx="144" cy="130" rx="12" ry="7" fill="#FF9EC4"/>';

const FACES: Record<SquishMood, string> = {
  // Eyes open, small smile: ready, or waiting for Claude.
  waiting: [
    `<ellipse cx="78" cy="112" rx="13" ry="15" fill="${INK}"/><ellipse cx="122" cy="112" rx="13" ry="15" fill="${INK}"/>`,
    '<circle cx="82" cy="106" r="5" fill="#FFFFFF"/><circle cx="126" cy="106" r="5" fill="#FFFFFF"/>',
    `<path d="M92 128q4 5 8 0q4 5 8 0" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  ].join(""),
  // Focused, eyes narrowed: Claude has the pin.
  working: [
    `<ellipse cx="78" cy="114" rx="13" ry="8" fill="${INK}"/><ellipse cx="122" cy="114" rx="13" ry="8" fill="${INK}"/>`,
    '<circle cx="82" cy="111" r="3.5" fill="#FFFFFF"/><circle cx="126" cy="111" r="3.5" fill="#FFFFFF"/>',
    `<path d="M93 130h14" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
  ].join(""),
  // Happy closed eyes and a wide smile: fixed.
  squashed: [
    `<path d="M66 114q12-14 24 0M110 114q12-14 24 0" stroke="${INK}" stroke-width="6" fill="none" stroke-linecap="round"/>`,
    `<path d="M88 126q12 12 24 0" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  ].join(""),
  // Worried brows and a wobbly mouth: it needs you.
  blocked: [
    `<path d="M64 94l22 6M136 94l-22 6" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
    `<ellipse cx="78" cy="114" rx="11" ry="13" fill="${INK}"/><ellipse cx="122" cy="114" rx="11" ry="13" fill="${INK}"/>`,
    '<circle cx="81" cy="109" r="4" fill="#FFFFFF"/><circle cx="125" cy="109" r="4" fill="#FFFFFF"/>',
    `<path d="M90 134q5-6 10 0q5 6 10 0" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  ].join(""),
};

/** Squish's head, for the header mark and the speech-bubble avatar. */
export function squishFace(mood: SquishMood = "waiting"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 30 160 140" aria-hidden="true">${BODY}${FACES[mood]}${CHEEKS}</svg>`;
}

/** Squish standing, with feet and the swatter: raised when a pin is fixed. */
export function squishSvg(mood: SquishMood): string {
  const swatter =
    mood === "squashed"
      ? `<path d="M172 128 L188 94" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><rect x="176" y="62" width="26" height="32" rx="9" fill="#FFB020" transform="rotate(20 189 78)"/>`
      : `<path d="M170 140 L196 126" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><rect x="186" y="104" width="22" height="28" rx="8" fill="#FFB020" transform="rotate(62 197 118)"/>`;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 180" aria-hidden="true">',
    swatter,
    '<ellipse cx="76" cy="164" rx="13" ry="7" fill="#4E3FE0"/><ellipse cx="124" cy="164" rx="13" ry="7" fill="#4E3FE0"/>',
    BODY,
    `<ellipse cx="168" cy="130" rx="9" ry="7" fill="${VIOLET}"/>`,
    FACES[mood],
    CHEEKS,
    "</svg>",
  ].join("");
}
