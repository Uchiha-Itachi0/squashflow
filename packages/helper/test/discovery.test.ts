import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionDisplayName } from "@squashflow/shared";
import { accountEnv, accountLabel, configuredDirs, readAccount } from "../src/accounts.js";
import type { RunCommand, RunOptions } from "../src/exec.js";
import { herdrLabels, herdrPlace } from "../src/herdr.js";
import { parseProcEnviron, parsePsLine, type ProcessInfo } from "../src/processes.js";
import { listSessions } from "../src/sessions.js";
import { fakeInbox, tempDir, type FakeInbox } from "./helpers.js";

interface Call {
  file: string;
  args: readonly string[];
  options: RunOptions | undefined;
}

describe("parsePsLine", () => {
  it("keeps only the account and terminal variables, values with spaces included", () => {
    const info = parsePsLine(
      "claude --add-dir /a TERM=xterm CLAUDE_CONFIG_DIR=/Users/me/My Claude HERDR_SOCKET_PATH=/s.sock HERDR_WORKSPACE_ID=w6S SECRET_TOKEN=abc",
    );
    expect(info).toEqual({
      isClaude: true,
      env: {
        CLAUDE_CONFIG_DIR: "/Users/me/My Claude",
        HERDR_SOCKET_PATH: "/s.sock",
        HERDR_WORKSPACE_ID: "w6S",
      },
    });
  });

  it("tells Claude Code from other programs, and reads no variable as the default account", () => {
    expect(parsePsLine("/opt/homebrew/bin/claude --resume HOME=/u").isClaude).toBe(true);
    expect(
      parsePsLine("node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js").isClaude,
    ).toBe(true);
    expect(parsePsLine("python3 server.py CLAUDE_CONFIG_DIR=/x").isClaude).toBe(false);
    expect(parsePsLine("claude HOME=/u").env).toEqual({});
  });
});

describe("parseProcEnviron", () => {
  it("reads Linux's NUL-separated environment", () => {
    const info = parseProcEnviron("HOME=/h\0CLAUDE_CONFIG_DIR=/h/.claude-work\0\0", [
      "/usr/bin/claude",
      "",
    ]);
    expect(info).toEqual({ isClaude: true, env: { CLAUDE_CONFIG_DIR: "/h/.claude-work" } });
  });
});

describe("accounts", () => {
  it("labels an account by its organisation, else its email's domain", () => {
    expect(
      accountLabel({ emailAddress: "dev@ideonlabs.com", organizationName: "Ideon Labs" }),
    ).toEqual({ label: "Ideon Labs", email: "dev@ideonlabs.com" });
    expect(
      accountLabel({
        emailAddress: "me@gmail.com",
        organizationName: "me@gmail.com's Organization",
      }),
    ).toEqual({ label: "gmail.com", email: "me@gmail.com" });
    expect(accountLabel({ emailAddress: "not an email\u0007" })).toBeNull();
    expect(accountLabel({ organizationName: `Acme\n${"x".repeat(200)}` })?.label).toHaveLength(60);
  });

  it("reads only the label and email from the account's .claude.json", async () => {
    const dir = await tempDir();
    try {
      const work = join(dir.path, "work");
      await mkdir(work);
      await writeFile(
        join(work, ".claude.json"),
        JSON.stringify({
          oauthAccount: {
            emailAddress: "a@acme.dev",
            accountUuid: "u-1",
            organizationName: "Acme",
          },
          primaryApiKey: "sk-secret",
        }),
      );
      await writeFile(
        join(dir.path, ".claude.json"),
        JSON.stringify({ oauthAccount: { emailAddress: "me@home.dev" } }),
      );
      expect(await readAccount(work)).toEqual({ label: "Acme", email: "a@acme.dev" });
      expect(await readAccount(null, dir.path)).toEqual({
        label: "home.dev",
        email: "me@home.dev",
      });
      expect(await readAccount(join(dir.path, "missing"))).toBeNull();
    } finally {
      await dir.cleanup();
    }
  });

  it("lists the helper's own account and the user's extra folders, and runs claude as each", () => {
    expect(configuredDirs({})).toEqual([null]);
    expect(
      configuredDirs({ CLAUDE_CONFIG_DIR: "/a", SQUASHFLOW_CLAUDE_CONFIG_DIRS: "/b::/c" }),
    ).toEqual(["/a", "/b", "/c"]);
    expect(accountEnv(null, { CLAUDE_CONFIG_DIR: "/a", PATH: "/bin" })).toEqual({ PATH: "/bin" });
    expect(accountEnv("/b", { PATH: "/bin" })).toEqual({ PATH: "/bin", CLAUDE_CONFIG_DIR: "/b" });
  });
});

describe("herdr labels", () => {
  const list = JSON.stringify({
    id: "cli:workspace:list",
    result: {
      workspaces: [
        { workspace_id: "w6S", label: "~vma" },
        { workspace_id: "w89", label: "~squash\u001b[31mflow" },
      ],
    },
  });

  it("asks each herdr server once, with fixed argv", async () => {
    const calls: Call[] = [];
    const run: RunCommand = (file, args, options) => {
      calls.push({ file, args, options });
      return Promise.resolve(list);
    };
    const places = [
      { socketPath: "/h.sock", workspaceId: "w6S" },
      { socketPath: "/h.sock", workspaceId: "w89" },
    ];
    const labels = await herdrLabels(run, places, { PATH: "/bin" });
    expect([...labels.values()]).toEqual(["~vma", "~squash [31mflow"]);
    expect(calls).toEqual([
      {
        file: "herdr",
        args: ["workspace", "list"],
        options: { env: { PATH: "/bin", HERDR_SOCKET_PATH: "/h.sock" } },
      },
    ]);
  });

  it("is quietly empty when herdr is missing, not running, or not in use", async () => {
    const missing: RunCommand = () => Promise.reject(new Error("ENOENT"));
    const stopped: RunCommand = () =>
      Promise.resolve('{"error":{"code":"server_not_running","message":"no herdr server"}}');
    const place = [{ socketPath: "/h.sock", workspaceId: "w6S" }];
    expect((await herdrLabels(missing, place)).size).toBe(0);
    expect((await herdrLabels(stopped, place)).size).toBe(0);
    expect(herdrPlace({ CLAUDE_CONFIG_DIR: "/a" })).toBeNull();
    expect(herdrPlace({ HERDR_SOCKET_PATH: "/h.sock", HERDR_WORKSPACE_ID: "w6S" })).toEqual(
      place[0],
    );
  });
});

describe("listSessions across accounts", () => {
  let dir: Awaited<ReturnType<typeof tempDir>>;
  let inboxes: FakeInbox[];
  let socketDir: string;
  let work: string;
  let personal: string;

  beforeEach(async () => {
    dir = await tempDir();
    socketDir = join(dir.path, "socks");
    // The default account lives in <home>/.claude; another under any folder name.
    work = join(dir.path, ".claude");
    personal = join(dir.path, "anything-at-all");
    await mkdir(socketDir);
    for (const folder of [work, personal]) {
      await mkdir(join(folder, "projects", "-w"), { recursive: true });
    }
    await writeFile(
      join(dir.path, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "dev@ideonlabs.com" } }),
    );
    await writeFile(
      join(personal, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "me@gmail.com" } }),
    );
    await writeFile(
      join(work, "projects", "-w", "s-work.jsonl"),
      `${JSON.stringify({ type: "ai-title", aiTitle: "Refill new VMA index" })}\n`,
    );
    inboxes = await Promise.all(
      [101, 202, 303, 404].map((pid) => fakeInbox(join(socketDir, `${pid}.sock`))),
    );
  });

  afterEach(async () => {
    await Promise.all(inboxes.map((inbox) => inbox.close()));
    await dir.cleanup();
  });

  it("lists every account's sessions, with account, title and terminal label", async () => {
    // 101: work (no CLAUDE_CONFIG_DIR) in herdr; 202: personal; 303: stale (pid gone);
    // 404: a pid now reused by another program; 505: personal, no socket of its own.
    const processes: Record<number, ProcessInfo> = {
      101: {
        isClaude: true,
        env: { HERDR_SOCKET_PATH: "/h.sock", HERDR_WORKSPACE_ID: "w6S" },
      },
      202: { isClaude: true, env: { CLAUDE_CONFIG_DIR: personal } },
      404: { isClaude: false, env: {} },
    };
    const calls: Call[] = [];
    const run: RunCommand = (file, args, options) => {
      calls.push({ file, args, options });
      if (file === "herdr") {
        return Promise.resolve(
          JSON.stringify({ result: { workspaces: [{ workspace_id: "w6S", label: "~vma" }] } }),
        );
      }
      if (file === "claude") {
        const account = options?.env?.CLAUDE_CONFIG_DIR;
        const agents =
          account === personal
            ? [
                { pid: 202, cwd: "/w", name: "pollenflow-18", status: "idle", sessionId: "s-p" },
                { pid: 505, cwd: "/w", name: "firstmate-62", status: "busy" },
              ]
            : [{ pid: 101, cwd: "/w", name: "firstmate-e1", status: "busy", sessionId: "s-work" }];
        return Promise.resolve(JSON.stringify(agents));
      }
      return Promise.reject(new Error("no git here"));
    };
    const sessions = await listSessions(run, {
      socketDir,
      env: { PATH: "/bin" },
      home: dir.path,
      readProcess: (pid) => Promise.resolve(processes[pid] ?? null),
    });

    expect(
      sessions.map((s) => [s.pid, s.name, s.configDir, s.account?.label, s.title, s.terminal]),
    ).toEqual([
      [101, "firstmate-e1", work, "ideonlabs.com", "Refill new VMA index", "~vma"],
      [202, "pollenflow-18", personal, "gmail.com", null, null],
      [505, "firstmate-62", personal, "gmail.com", null, null],
    ]);
    const claudeCalls = calls.filter((call) => call.file === "claude");
    expect(claudeCalls.map((call) => [call.args, call.options?.env])).toEqual([
      [["agents", "--json"], { PATH: "/bin" }],
      [["agents", "--json"], { PATH: "/bin", CLAUDE_CONFIG_DIR: personal }],
    ]);
  });

  it("still shows a live session no account lists, with what is known", async () => {
    const run: RunCommand = (file) =>
      file === "claude" ? Promise.resolve("[]") : Promise.reject(new Error("no"));
    const sessions = await listSessions(run, {
      socketDir,
      env: {},
      home: dir.path,
      readProcess: (pid) =>
        Promise.resolve(
          pid === 202 ? { isClaude: true, env: { CLAUDE_CONFIG_DIR: personal } } : null,
        ),
    });
    expect(sessions).toEqual([
      expect.objectContaining({
        pid: 202,
        name: "pid-202",
        cwd: "",
        sessionId: null,
        configDir: personal,
        account: { label: "gmail.com", email: "me@gmail.com" },
      }),
    ]);
  });

  it("skips a socket that fails the ownership and mode check", async () => {
    const loose = await fakeInbox(join(socketDir, "606.sock"), 0o666);
    inboxes.push(loose);
    const asked: number[] = [];
    const run: RunCommand = (file) =>
      file === "claude" ? Promise.resolve("[]") : Promise.reject(new Error("no"));
    await listSessions(run, {
      socketDir,
      env: {},
      home: dir.path,
      readProcess: (pid) => {
        asked.push(pid);
        return Promise.resolve(null);
      },
    });
    expect(asked.sort()).toEqual([101, 202, 303, 404]);
  });
});

describe("sessionDisplayName", () => {
  const base = { name: "firstmate-e1", title: null, terminal: null, cwd: "/Users/me/code/vma" };
  it("prefers the title, then the terminal label, then the folder, then the raw name", () => {
    expect(sessionDisplayName({ ...base, title: "Refill new VMA index", terminal: "~vma" })).toBe(
      "Refill new VMA index",
    );
    expect(sessionDisplayName({ ...base, terminal: "~vma" })).toBe("~vma");
    expect(sessionDisplayName(base)).toBe("vma");
    expect(sessionDisplayName({ ...base, cwd: "" })).toBe("firstmate-e1");
  });
});
