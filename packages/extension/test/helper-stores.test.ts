import type { PublicSession } from "@squashflow/shared";
import { describe, expect, it } from "vitest";
import { ConnectionStore, type SecretArea } from "../src/helper/connection";
import { matchSessions } from "../src/helper/matching";
import { siteOf, SiteRepoStore } from "../src/helper/sites";
import type { StorageAreaLike } from "../src/store/pins";

function memorySecrets(): SecretArea & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: (key) => Promise.resolve(data.get(key)),
    set: (key, value) => {
      data.set(key, structuredClone(value));
      return Promise.resolve();
    },
    delete: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
  };
}

function memoryArea(): StorageAreaLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: (key) => Promise.resolve(key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: (items) => {
      Object.assign(data, structuredClone(items));
      return Promise.resolve();
    },
    remove: (key) => {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete data[key];
      return Promise.resolve();
    },
  };
}

const TOKEN = "tok_0123456789abcdefghij";

describe("ConnectionStore", () => {
  it("is unpaired until saved, keeps port and token, and forgets them", async () => {
    const store = new ConnectionStore(memorySecrets());
    expect(await store.load()).toBeNull();
    expect(await store.port()).toBe(47821);
    await store.save({ port: 5000, token: TOKEN });
    expect(await store.load()).toEqual({ port: 5000, token: TOKEN });
    expect(await store.port()).toBe(5000);
    await store.forget();
    expect(await store.load()).toBeNull();
  });

  it("treats a tampered record as unpaired and refuses to save a bad one", async () => {
    const area = memorySecrets();
    area.data.set("helper-connection", { port: 0, token: "x" });
    const store = new ConnectionStore(area);
    expect(await store.load()).toBeNull();
    await expect(store.save({ port: 80, token: "has spaces in it, nope" })).rejects.toThrow();
  });
});

describe("SiteRepoStore", () => {
  it("remembers a repository per origin and forgets it", async () => {
    const area = memoryArea();
    const sites = new SiteRepoStore(area);
    expect(siteOf("https://shop.example.com/cart?x=1#y")).toBe("https://shop.example.com");
    expect(await sites.get("https://shop.example.com/")).toBeNull();

    await sites.set("https://shop.example.com/cart", "acme/shop");
    await sites.set("http://localhost:3000/", "gitlab.example.com/team/app");
    expect(await sites.get("https://shop.example.com/other/page")).toBe("acme/shop");
    expect(await sites.get("http://localhost:3000/x")).toBe("gitlab.example.com/team/app");
    expect(await sites.get("http://localhost:3001/")).toBeNull();

    await sites.set("https://shop.example.com/", "acme/shop-v2");
    expect(await sites.get("https://shop.example.com/")).toBe("acme/shop-v2");

    await sites.set("https://shop.example.com/", null);
    await sites.set("http://localhost:3000/", null);
    expect(area.data).toEqual({});
  });

  it("rejects names that are not repositories and ignores corrupt storage", async () => {
    const area = memoryArea();
    const sites = new SiteRepoStore(area);
    await expect(sites.set("https://a.example/", "not a repo")).rejects.toThrow();
    area.data["site-repos"] = { "https://a.example": "<script>" };
    expect(await sites.get("https://a.example/")).toBeNull();
  });
});

describe("matchSessions", () => {
  const session = (pid: number, repo: string | null): PublicSession => ({
    pid,
    name: `s${pid}`,
    status: "idle",
    cwd: `/w/${pid}`,
    repo,
    title: null,
    branch: null,
    startedAt: null,
    lastActiveAt: null,
  });

  it("preselects the one session on the page's repository", () => {
    const sessions = [session(1, "acme/web"), session(2, "acme/api"), session(3, null)];
    expect(matchSessions(sessions, "Acme/Web")).toEqual({
      matching: [sessions[0]],
      preselectedPid: 1,
    });
  });

  it("lets the user pick when several match, none match, or the repository is unknown", () => {
    const sessions = [session(1, "acme/web"), session(2, "acme/web")];
    expect(matchSessions(sessions, "acme/web")).toEqual({
      matching: sessions,
      preselectedPid: null,
    });
    expect(matchSessions(sessions, "acme/other")).toEqual({ matching: [], preselectedPid: null });
    expect(matchSessions(sessions, null)).toEqual({ matching: [], preselectedPid: null });
  });
});
