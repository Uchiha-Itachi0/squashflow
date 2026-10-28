#!/usr/bin/env node
/**
 * Pack the helper as npm would publish it, then run `npx squashflow` from that tarball in
 * an empty folder with an empty npm cache: the check that the published package works
 * without the monorepo around it. It does not publish anything.
 *
 * Run after `pnpm build`: node scripts/check-helper-pack.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const helperPackage = JSON.parse(readFileSync(join(root, "packages/helper/package.json"), "utf8"));
const work = mkdtempSync(join(tmpdir(), "squashflow-pack-"));

try {
  const packDir = join(work, "pack");
  execFileSync("pnpm", ["--filter", "squashflow", "pack", "--pack-destination", packDir], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const tarball = readdirSync(packDir).find((name) => name.endsWith(".tgz"));
  if (tarball === undefined) throw new Error("pnpm pack produced no tarball");
  const tarballPath = join(packDir, tarball);

  const listing = execFileSync("tar", ["-tzf", tarballPath], { encoding: "utf8" });
  const packed = JSON.parse(
    execFileSync("tar", ["-xzOf", tarballPath, "package/package.json"], { encoding: "utf8" }),
  );
  const dependencies = Object.keys(packed.dependencies ?? {});
  if (dependencies.some((name) => name.startsWith("@squashflow/"))) {
    throw new Error(`The packed helper depends on a workspace package: ${dependencies.join(", ")}`);
  }
  if (!listing.includes("package/dist/cli.js")) throw new Error("The tarball has no dist/cli.js");

  const run = (...args) =>
    execFileSync(
      "npx",
      [
        "--yes",
        "--cache",
        join(work, "npm-cache"),
        "--package",
        tarballPath,
        "squashflow",
        ...args,
      ],
      {
        cwd: mkdtempSync(join(work, "run-")),
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1", npm_config_update_notifier: "false" },
      },
    ).trim();

  const version = run("--version");
  if (version !== helperPackage.version) {
    throw new Error(
      `npx squashflow --version printed "${version}", expected ${helperPackage.version}`,
    );
  }
  if (!run("--help").includes("squashflow [start]"))
    throw new Error("npx squashflow --help failed");
  process.stdout.write(`npx squashflow works from ${tarball} (version ${version})\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
