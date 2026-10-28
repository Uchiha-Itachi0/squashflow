#!/usr/bin/env node
/**
 * Package the production build for the Chrome Web Store: zip `build/chrome-mv3-prod` into
 * `build/squashflow-<version>.zip`, deterministically, and print its SHA-256.
 *
 * The version lives only in this package's package.json: Plasmo writes it into the
 * manifest, and this script checks the built manifest agrees before zipping.
 * Run with `pnpm --filter @squashflow/extension package`, which builds first.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { zipFiles } from "./zip.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build", "chrome-mv3-prod");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(buildDir, "manifest.json"), "utf8"));

if (manifest.version !== version) {
  throw new Error(`The built manifest says ${manifest.version}, package.json says ${version}.`);
}
if (manifest.key !== undefined || manifest.update_url !== undefined) {
  throw new Error("The Web Store sets key and update_url itself; the manifest must not.");
}

/** @returns {string[]} */
function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing to package a symlink: ${path}`);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

const files = listFiles(buildDir)
  .filter((path) => !path.endsWith(".map"))
  .map((path) => ({
    path: relative(buildDir, path).split(sep).join("/"),
    data: readFileSync(path),
  }));
const zip = zipFiles(files);
const out = join(root, "build", `squashflow-${version}.zip`);
writeFileSync(out, zip);
const sha256 = createHash("sha256").update(zip).digest("hex");
process.stdout.write(`${relative(process.cwd(), out)}  ${files.length} files  sha256 ${sha256}\n`);
