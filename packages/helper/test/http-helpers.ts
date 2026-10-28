import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { DeliveryService } from "../src/delivery.js";
import { startServer, type HelperContext, type RunningServer } from "../src/http/server.js";
import { hashToken, PairingCodes } from "../src/pairing.js";
import type { SessionInfo } from "../src/sessions.js";

export const EXTENSION_ORIGIN = `chrome-extension://${"a".repeat(32)}`;
export const TOKEN = "test-token-0123456789abcdefghijklmnop";

export interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed test convenience
  json<T = Record<string, unknown>>(): T;
}

export interface SendOptions {
  method?: string;
  path: string;
  headers?: Record<string, string | undefined>;
  body?: string;
}

export function send(
  port: number,
  { method = "GET", path, headers = {}, body }: SendOptions,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const clean = Object.fromEntries(
      Object.entries(headers).filter(([, value]) => value !== undefined),
    ) as Record<string, string>;
    if (body !== undefined && clean["transfer-encoding"] === undefined) {
      clean["content-length"] = String(Buffer.byteLength(body));
    }
    const req = httpRequest({ host: "127.0.0.1", port, method, path, headers: clean }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: text,
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed test convenience
          json: <T>() => JSON.parse(text) as T,
        });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export interface TestHelper {
  server: RunningServer;
  context: HelperContext;
  pairing: PairingCodes;
  /** Headers for an authenticated request from the paired extension. */
  auth(extra?: Record<string, string | undefined>): Record<string, string | undefined>;
  close(): Promise<void>;
}

export async function startTestHelper(
  dir: string,
  sessions: SessionInfo[],
  { paired = true }: { paired?: boolean } = {},
): Promise<TestHelper> {
  const pairing = new PairingCodes();
  const delivery = new DeliveryService({
    socketDir: join(dir, "socks"),
    claudeConfigDir: join(dir, "claude"),
    senderSocketPath: join(dir, "sender.sock"),
    pollMs: 20,
  });
  const context: HelperContext = {
    port: 0,
    maxBodyBytes: 1024,
    auth: paired
      ? { tokenHash: hashToken(TOKEN), origin: EXTENSION_ORIGIN }
      : { tokenHash: null, origin: null },
    pairing,
    savePairing: () => Promise.resolve(),
    delivery,
    discover: () => Promise.resolve(sessions),
    log: { info: () => undefined, arrow: () => undefined, warn: () => undefined },
  };
  const server = await startServer(context);
  return {
    server,
    context,
    pairing,
    auth: (extra = {}) => ({
      host: `127.0.0.1:${server.port}`,
      origin: EXTENSION_ORIGIN,
      authorization: `Bearer ${TOKEN}`,
      ...extra,
    }),
    close: async () => {
      delivery.close();
      await server.close();
    },
  };
}
