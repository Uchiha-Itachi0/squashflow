/**
 * Render the extension icons from Squish's SVGs, at the sizes Chrome and the Web Store
 * use. Plasmo copies `assets/icon<size>.png` into the build as they are.
 *
 * - 16 and 32 px: the simplified Squish (`squish-small.svg`), which stays legible small.
 * - 48 and 64 px: the full Squish with its swatter (`squish-icon.svg`), a little padded.
 * - 128 px: the full Squish in the middle 96 px, as the Web Store asks for store icons.
 * - `icon.png` (512 px): the fallback Plasmo resizes from for any size not given.
 *
 * Run from packages/extension after changing an SVG: node scripts/render-icons.ts
 */

import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

const ICONS = [
  { file: "icon16.png", svg: "squish-small.svg", size: 16, art: 16 },
  { file: "icon32.png", svg: "squish-small.svg", size: 32, art: 32 },
  { file: "icon48.png", svg: "squish-icon.svg", size: 48, art: 46 },
  { file: "icon64.png", svg: "squish-icon.svg", size: 64, art: 60 },
  { file: "icon128.png", svg: "squish-icon.svg", size: 128, art: 96 },
  { file: "icon.png", svg: "squish-icon.svg", size: 512, art: 496 },
] as const;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { file, svg, size, art } of ICONS) {
    const source = (await readFile(join(assets, svg))).toString("base64");
    const offset = (size - art) / 2;
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${source}" style="position:absolute;left:${offset}px;top:${offset}px;width:${art}px;height:${art}px"></body>`,
    );
    await page.locator("img").evaluate((image: HTMLImageElement) => image.decode());
    await page.screenshot({ path: join(assets, file), omitBackground: true });
  }
} finally {
  await browser.close();
}
