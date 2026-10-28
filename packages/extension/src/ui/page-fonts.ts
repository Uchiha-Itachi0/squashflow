/**
 * The pin UI's fonts on the page, bundled with the extension: Geist for text and Geist
 * Mono for numbers and selectors. They are added to the page's font set from bytes
 * inside the script (no URL to fetch, so no web accessible resource and nothing for the
 * page's content security policy to block), under names no page uses, and removed again
 * when pin mode stops.
 */

import geist400 from "data-base64:../../assets/fonts/geist-400.woff2";
import geist600 from "data-base64:../../assets/fonts/geist-600.woff2";
import geistMono500 from "data-base64:../../assets/fonts/geist-mono-500.woff2";
import { base64ToBuffer } from "../capture/screenshot";

export const PAGE_SANS = "Squashflow Geist";
export const PAGE_MONO = "Squashflow Geist Mono";

const FACES: readonly [string, string, string][] = [
  [PAGE_SANS, geist400, "400"],
  [PAGE_SANS, geist600, "600"],
  [PAGE_MONO, geistMono500, "500"],
];

/** Add the fonts to the page; returns a function that removes them. */
export function addPageFonts(): () => void {
  const faces = FACES.flatMap(([family, dataUrl, weight]) => {
    try {
      const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const face = new FontFace(family, base64ToBuffer(data), { weight });
      document.fonts.add(face);
      return [face];
    } catch {
      // A page that replaced the font set still gets the system font fallback.
      return [];
    }
  });
  return () => {
    for (const face of faces) document.fonts.delete(face);
  };
}
