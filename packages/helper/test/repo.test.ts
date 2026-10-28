import { describe, expect, it } from "vitest";
import { normaliseRemoteUrl } from "../src/repo.js";

describe("normaliseRemoteUrl", () => {
  it.each([
    ["git@github.com:acme/widgets.git", "acme/widgets"],
    ["git@github.com:acme/widgets", "acme/widgets"],
    ["https://github.com/acme/widgets.git", "acme/widgets"],
    ["https://github.com/acme/widgets/", "acme/widgets"],
    ["https://user@github.com/acme/widgets", "acme/widgets"],
    ["ssh://git@github.com/acme/widgets.git", "acme/widgets"],
    ["ssh://git@github.com:22/acme/widgets.git", "acme/widgets"],
    ["git://github.com/acme/widgets.git", "acme/widgets"],
    ["HTTPS://GitHub.com/acme/widgets.git\n", "acme/widgets"],
    ["git@ghe.example.com:team/app.git", "ghe.example.com/team/app"],
  ])("normalises %s to %s", (input, expected) => {
    expect(normaliseRemoteUrl(input)?.fullName).toBe(expected);
  });

  it.each([
    "",
    "not a url",
    "/local/path/repo.git",
    "file:///local/repo.git",
    "https://github.com/only-owner",
    "https://github.com/a/b/c",
    "git@github.com:acme/..",
  ])("rejects %j", (input) => {
    expect(normaliseRemoteUrl(input)).toBeNull();
  });
});
