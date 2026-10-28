import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/helper/client";
import { ConnectionStore, type SecretArea } from "../src/helper/connection";
import { HelperService } from "../src/helper/service";
import { SiteRepoStore } from "../src/helper/sites";
import type { StorageAreaLike } from "../src/store/pins";

const TOKEN = "tok_0123456789abcdefghij";
const PAGE = "https://shop.example.com/cart";
const session = { pid: 42, name: "web", status: "idle", cwd: "/w/web", repo: "acme/web" };

type Route = (init: RequestInit) => { status: number; body: unknown } | "down";

function helperFetch(routes: Record<string, Route>): FetchLike & { paths: string[] } {
  const paths: string[] = [];
  const fetch = (url: string, init: RequestInit): Promise<Response> => {
    const path = new URL(url).pathname;
    paths.push(`${init.method ?? "GET"} ${new URL(url).port} ${path}`);
    const route = routes[path];
    const answer = route ? route(init) : { status: 404, body: { error: "Not found" } };
    if (answer === "down") return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }));
  };
  return Object.assign(fetch, { paths });
}

function memorySecrets(): SecretArea {
  const data = new Map<string, unknown>();
  return {
    get: (key) => Promise.resolve(data.get(key)),
    set: (key, value) => Promise.resolve(void data.set(key, value)),
    delete: (key) => Promise.resolve(void data.delete(key)),
  };
}

function memoryArea(): StorageAreaLike {
  const data: Record<string, unknown> = {};
  return {
    get: (key) => Promise.resolve(key in data ? { [key]: data[key] } : {}),
    set: (items) => {
      Object.assign(data, items);
      return Promise.resolve();
    },
    remove: (key) => {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete data[key];
      return Promise.resolve();
    },
  };
}

function setup(routes: Record<string, Route>) {
  const fetch = helperFetch(routes);
  const connections = new ConnectionStore(memorySecrets());
  const sites = new SiteRepoStore(memoryArea());
  return { fetch, connections, sites, service: new HelperService({ fetch, connections, sites }) };
}

const healthy: Route = () => ({ status: 200, body: { ok: true, paired: true, version: "0.1.0" } });

describe("HelperService pairing state", () => {
  it("is unpaired with the default port before pairing, without calling the helper", async () => {
    const { service, fetch } = setup({});
    expect(await service.handle({ type: "status" })).toEqual({
      ok: true,
      value: { state: "unpaired", port: 47821 },
    });
    expect(fetch.paths).toEqual([]);
  });

  it("pairs on the given port, keeps the token, and reports paired", async () => {
    const { service, connections, fetch } = setup({
      "/pair": () => ({ status: 200, body: { token: TOKEN } }),
      "/health": healthy,
    });
    const reply = await service.handle({ type: "pair", code: "ABCD-EFGH", port: 5123 });
    expect(reply).toEqual({ ok: true, value: { state: "paired", port: 5123, version: "0.1.0" } });
    expect(await connections.load()).toEqual({ port: 5123, token: TOKEN });
    expect(fetch.paths).toEqual(["POST 5123 /pair", "GET 5123 /health"]);
  });

  it("keeps nothing when the code is wrong", async () => {
    const { service, connections } = setup({
      "/pair": () => ({ status: 401, body: { error: "Wrong pairing code" } }),
    });
    const reply = await service.handle({ type: "pair", code: "NOPE", port: 5123 });
    expect(reply.ok).toBe(false);
    expect(await connections.load()).toBeNull();
  });

  it("reports a rejected token as unpaired and a stopped helper as unreachable", async () => {
    const rejected = setup({
      "/health": () => ({ status: 401, body: { error: "Invalid token" } }),
    });
    await rejected.connections.save({ port: 5123, token: TOKEN });
    const status = await rejected.service.handle({ type: "status" });
    expect(status.ok && status.value).toMatchObject({ state: "unpaired", port: 5123 });

    const stopped = setup({ "/health": () => "down" });
    await stopped.connections.save({ port: 5123, token: TOKEN });
    const down = await stopped.service.handle({ type: "status" });
    expect(down.ok && down.value).toMatchObject({ state: "unreachable", port: 5123 });
  });

  it("forgets the pairing", async () => {
    const { service, connections } = setup({});
    await connections.save({ port: 5123, token: TOKEN });
    const reply = await service.handle({ type: "forget" });
    expect(reply).toEqual({ ok: true, value: { state: "unpaired", port: 47821 } });
    expect(await connections.load()).toBeNull();
  });
});

describe("HelperService sessions and sending", () => {
  it("lists sessions with the site's remembered repository", async () => {
    const { service, connections } = setup({
      "/sessions": () => ({ status: 200, body: { sessions: [session] } }),
    });
    await connections.save({ port: 5123, token: TOKEN });
    await service.handle({ type: "remember-site", pageUrl: PAGE, repo: "acme/web" });
    expect(
      await service.handle({ type: "sessions", pageUrl: "https://shop.example.com/" }),
    ).toEqual({ ok: true, value: { sessions: [session], repo: "acme/web" } });
  });

  it("previews and sends through the helper with the stored token", async () => {
    const bodies: unknown[] = [];
    const digest = "b".repeat(64);
    const { service, connections } = setup({
      "/pins": (init) => {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        bodies.push(body);
        if (body.preview === true) {
          return { status: 200, body: { pinId: "sf-0123456789ab", digest, message: "m" } };
        }
        return {
          status: 409,
          body: { error: "No preview with that pin id; preview the message again" },
        };
      },
    });
    await connections.save({ port: 5123, token: TOKEN });
    const outgoing = { session: 42, pageUrl: PAGE, pins: [{ comment: "Fix it" }] };
    const preview = await service.handle({ type: "preview", outgoing });
    expect(preview).toEqual({
      ok: true,
      value: { pinId: "sf-0123456789ab", digest, message: "m" },
    });
    const sent = await service.handle({ type: "send", outgoing, pinId: "sf-0123456789ab", digest });
    expect(!sent.ok && sent.failure.kind).toBe("expired");
    expect(bodies[1]).toEqual({ ...outgoing, pinId: "sf-0123456789ab", digest });
  });

  it("refuses malformed requests without calling the helper", async () => {
    const { service, fetch } = setup({});
    for (const request of [
      { type: "unknown" },
      { type: "pair", code: "", port: 5123 },
      { type: "pair", code: "ABCD", port: 70000 },
      { type: "sessions", pageUrl: "javascript:alert(1)" },
      { type: "preview", outgoing: { session: 1, pageUrl: PAGE, pins: [] } },
      { type: "send", outgoing: { session: 1, pageUrl: PAGE, pins: [{ comment: "x" }] } },
      { type: "remember-site", pageUrl: PAGE, repo: "../../etc" },
    ]) {
      const reply = await service.handle(request);
      expect(reply.ok).toBe(false);
    }
    expect(fetch.paths).toEqual([]);
  });
});
