import { describe, expect, it } from "vitest";
import { pageToPanelSchema } from "../src/panel/protocol";
import { DEFAULT_SETTINGS, readSettings, SettingsStore } from "../src/settings";
import type { StorageAreaLike } from "../src/store/pins";

function memoryArea(): StorageAreaLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: (key) => Promise.resolve(key in data ? { [key]: data[key] } : {}),
    set: (items) => {
      Object.assign(data, items);
      return Promise.resolve();
    },
    remove: () => Promise.resolve(),
  };
}

describe("settings", () => {
  it("defaults to batching, standard detail and sending", () => {
    expect(readSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ sendMode: "batch", level: "standard", copyOnly: false });
  });

  it("keeps what is valid and defaults what is not", () => {
    expect(readSettings({ sendMode: "now", level: "loud", copyOnly: "yes" })).toEqual({
      sendMode: "now",
      level: "standard",
      copyOnly: false,
    });
  });

  it("changes one setting at a time and stores them together", async () => {
    const area = memoryArea();
    const store = new SettingsStore(area);
    await store.change({ sendMode: "now" });
    const next = await store.change({ level: "forensic" });
    expect(next).toEqual({ sendMode: "now", level: "forensic", copyOnly: false });
    expect(area.data.settings).toEqual(next);
  });
});

describe("what the page may tell the side panel", () => {
  it("accepts the page's messages", () => {
    for (const message of [
      { type: "hello", url: "https://shop.example.com/cart" },
      { type: "go" },
      { type: "send-pin", pinId: "sf-0123456789ab" },
      { type: "open-pin", pinId: "sf-0123456789ab" },
      { type: "open-tab", tab: "sessions" },
    ]) {
      expect(pageToPanelSchema.safeParse(message).success).toBe(true);
    }
  });

  it("refuses anything else", () => {
    for (const message of [
      { type: "hello", url: "javascript:alert(1)" },
      { type: "send-pin", pinId: "../../token" },
      { type: "open-tab", tab: "secrets" },
      { type: "send", outgoing: {} },
      { type: "go", extra: true },
    ]) {
      expect(pageToPanelSchema.safeParse(message).success).toBe(false);
    }
  });
});
