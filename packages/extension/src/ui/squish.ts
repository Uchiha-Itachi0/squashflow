/**
 * Squish, the Squashflow mascot (Mochi variant from the design canvas): a round violet
 * mochi with big shiny eyes, pink cheeks, tiny feet and a small amber swatter.
 * The markup is a constant; no page data ever goes into it.
 */

export type SquishMood = "waiting" | "working" | "squashed" | "blocked";

const EYES: Record<SquishMood, string> = {
  waiting:
    '<ellipse cx="24" cy="37" rx="5" ry="6" fill="#1D1640"/><ellipse cx="40" cy="37" rx="5" ry="6" fill="#1D1640"/><circle cx="25.8" cy="34.6" r="2" fill="#fff"/><circle cx="41.8" cy="34.6" r="2" fill="#fff"/>',
  working:
    '<ellipse cx="24" cy="38" rx="5" ry="4" fill="#1D1640"/><ellipse cx="40" cy="38" rx="5" ry="4" fill="#1D1640"/><circle cx="25.8" cy="36.8" r="1.6" fill="#fff"/><circle cx="41.8" cy="36.8" r="1.6" fill="#fff"/>',
  squashed:
    '<path d="M19 38q5-6 10 0M35 38q5-6 10 0" stroke="#1D1640" stroke-width="2.6" stroke-linecap="round" fill="none"/>',
  blocked:
    '<path d="M20 34l8 6M28 34l-8 6M36 34l8 6M44 34l-8 6" stroke="#1D1640" stroke-width="2.4" stroke-linecap="round"/>',
};

export function squishSvg(mood: SquishMood): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true">',
    '<ellipse cx="25" cy="57" rx="5" ry="3" fill="#4B3FD1"/>',
    '<ellipse cx="39" cy="57" rx="5" ry="3" fill="#4B3FD1"/>',
    '<path d="M8 38c0-15 10-26 24-26s24 11 24 26c0 11-10 18-24 18S8 49 8 38z" fill="#6B5BFF"/>',
    '<path d="M15 28c3-7 9-11 16-11" stroke="#fff" stroke-opacity=".35" stroke-width="3" stroke-linecap="round" fill="none"/>',
    EYES[mood],
    '<ellipse cx="17" cy="45" rx="3.5" ry="2.2" fill="#FF8FB8"/>',
    '<ellipse cx="47" cy="45" rx="3.5" ry="2.2" fill="#FF8FB8"/>',
    '<path d="M29 46q3 2.5 6 0" stroke="#1D1640" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
    '<path d="M54 40l5-22" stroke="#B7791F" stroke-width="2.5" stroke-linecap="round"/>',
    '<rect x="53" y="5" width="12" height="13" rx="3" transform="rotate(13 59 11)" fill="#F5A524"/>',
    "</svg>",
  ].join("");
}
