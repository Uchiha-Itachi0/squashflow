import { describe, expect, it } from "vitest";
import { MAX_PINS_PER_PAGE } from "../src/constants";
import { pageKey, PinStore, pinPageUrl, type StorageAreaLike } from "../src/store/pins";

function memoryArea(initial: Record<string, unknown> = {}): StorageAreaLike & {
  data: Record<string, unknown>;
} {
  const data: Record<string, unknown> = { ...initial };
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

const context = { selector: "#buy", text: "Buy" };
const PAGE = "https://example.com/pricing?plan=pro#faq";

describe("pageKey and pinPageUrl", () => {
  it("keys pins by origin and path and drops the fragment from the pin URL", () => {
    expect(pageKey(PAGE)).toBe("pins:https://example.com/pricing");
    expect(pageKey("https://example.com/pricing")).toBe(pageKey(PAGE));
    expect(pinPageUrl(PAGE)).toBe("https://example.com/pricing?plan=pro");
  });
});

describe("PinStore", () => {
  it("keeps a pin's screenshot through edits, and drops one that fails validation", async () => {
    const area = memoryArea();
    const store = new PinStore(area, PAGE);
    const screenshot = {
      type: "image/png" as const,
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      width: 1,
      height: 1,
    };
    const pin = await store.add({ comment: "With a shot", context, screenshot });
    await store.add({ comment: "Without", context, screenshot: undefined });
    await store.update(pin.id, "Edited");
    const [first, second] = await store.list();
    expect(first?.screenshot).toEqual(screenshot);
    expect(second && "screenshot" in second).toBe(false);

    const key = pageKey(PAGE);
    const stored = area.data[key] as Record<string, unknown>[];
    area.data[key] = [
      { ...stored[0], screenshot: { ...screenshot, type: "image/jpeg" } },
      stored[1],
    ];
    expect((await store.list()).map((entry) => entry.comment)).toEqual(["Without"]);
  });

  it("adds, lists, edits and deletes pins in order", async () => {
    let time = 1000;
    const store = new PinStore(memoryArea(), PAGE, () => time);
    const first = await store.add({ comment: "Make it blue", context });
    time = 2000;
    const second = await store.add({ comment: "  Bigger  ", context });
    expect(first.id).toMatch(/^sf-[0-9a-f]{12}$/);
    expect(second.comment).toBe("Bigger");
    expect(second.pageUrl).toBe("https://example.com/pricing?plan=pro");
    expect((await store.list()).map((pin) => pin.id)).toEqual([first.id, second.id]);

    time = 3000;
    const edited = await store.update(first.id, "Make it green");
    expect(edited).toMatchObject({ comment: "Make it green", createdAt: 1000, updatedAt: 3000 });
    expect((await store.list())[0]?.comment).toBe("Make it green");

    await store.remove(first.id);
    expect((await store.list()).map((pin) => pin.id)).toEqual([second.id]);
  });

  it("keeps pages apart and removes the key when the last pin goes", async () => {
    const area = memoryArea();
    const pricing = new PinStore(area, PAGE);
    const home = new PinStore(area, "https://example.com/");
    const pin = await pricing.add({ comment: "x", context });
    expect(await home.list()).toEqual([]);
    await pricing.remove(pin.id);
    expect(Object.keys(area.data)).toEqual([]);
  });

  it("drops stored entries that fail validation", async () => {
    const store = new PinStore(memoryArea(), PAGE);
    const good = await store.add({ comment: "ok", context });
    const area = memoryArea({
      [pageKey(PAGE)]: [good, { id: "bad", comment: "" }, { ...good, context: { extra: 1 } }],
    });
    expect(await new PinStore(area, PAGE).list()).toEqual([good]);
    expect(await new PinStore(memoryArea({ [pageKey(PAGE)]: "nope" }), PAGE).list()).toEqual([]);
  });

  it("rejects empty comments, unknown pins and pages that are full", async () => {
    const store = new PinStore(memoryArea(), PAGE);
    await expect(store.add({ comment: "   ", context })).rejects.toThrow();
    await expect(store.update("sf-000000000000", "x")).rejects.toThrow("no longer exists");
    for (let i = 0; i < MAX_PINS_PER_PAGE; i += 1)
      await store.add({ comment: `pin ${i}`, context });
    await expect(store.add({ comment: "one more", context })).rejects.toThrow("at most");
  });
});
