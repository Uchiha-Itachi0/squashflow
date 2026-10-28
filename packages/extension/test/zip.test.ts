import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { zipFiles } from "../scripts/zip.mjs";

const files = [
  { path: "manifest.json", data: Buffer.from('{"version":"0.1.0"}') },
  { path: "static/background/index.js", data: Buffer.from("x".repeat(5000)) },
  { path: "icon16.png", data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]) },
];

describe("zipFiles", () => {
  it("gives the same bytes for the same files, in any order", () => {
    expect(zipFiles(files)).toEqual(zipFiles([...files].reverse()));
  });

  it("writes an archive unzip can read back exactly", () => {
    const dir = mkdtempSync(join(tmpdir(), "sqf-zip-"));
    try {
      const zip = join(dir, "test.zip");
      writeFileSync(zip, zipFiles(files));
      expect(execFileSync("unzip", ["-t", zip], { encoding: "utf8" })).toContain("No errors");
      for (const file of files) {
        expect(execFileSync("unzip", ["-p", zip, file.path])).toEqual(Buffer.from(file.data));
      }
      expect(execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n")).toEqual([
        "icon16.png",
        "manifest.json",
        "static/background/index.js",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses paths that would leave the archive's folder", () => {
    expect(() => zipFiles([{ path: "../evil", data: new Uint8Array() }])).toThrow();
    expect(() => zipFiles([{ path: "/abs", data: new Uint8Array() }])).toThrow();
  });
});
