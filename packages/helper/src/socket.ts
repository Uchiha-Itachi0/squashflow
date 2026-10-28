/** Delivery to a session's inbox socket, plus the helper's own sender socket. */

import { lstat, mkdir, chmod, rm } from "node:fs/promises";
import { createConnection, createServer, type Server } from "node:net";
import { join } from "node:path";
import { DEFAULT_INBOX_SOCKET_DIR } from "./constants.js";

const OWNER_ONLY_MODE = 0o600;
const SOCKET_WRITE_TIMEOUT_MS = 5000;

export class SocketRefusedError extends Error {
  override readonly name = "SocketRefusedError";
}

/**
 * Where session inbox sockets are looked up. `SQUASHFLOW_INBOX_SOCKET_DIR` overrides it,
 * so tests can deliver to a fake inbox without touching the real socket folder.
 */
export function inboxSocketDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.SQUASHFLOW_INBOX_SOCKET_DIR;
  return override !== undefined && override !== "" ? override : DEFAULT_INBOX_SOCKET_DIR;
}

export function inboxSocketPath(socketDir: string, pid: number): string {
  return join(socketDir, `${pid}.sock`);
}

/**
 * Refuse anything that is not a socket owned by this user with mode 0600.
 * lstat, so a symlink planted at the path is refused rather than followed.
 */
export async function checkInboxSocket(
  path: string,
  uid: number | undefined = process.getuid?.(),
): Promise<void> {
  let info;
  try {
    info = await lstat(path);
  } catch {
    throw new SocketRefusedError(
      `No inbox socket at ${path}. The session may be a --bare session or older than the minimum Claude Code version.`,
    );
  }
  if (!info.isSocket()) throw new SocketRefusedError(`${path} is not a socket.`);
  if (uid === undefined || info.uid !== uid) {
    throw new SocketRefusedError(`${path} is not owned by the current user.`);
  }
  const mode = info.mode & 0o777;
  if (mode !== OWNER_ONLY_MODE) {
    throw new SocketRefusedError(
      `${path} has mode ${mode.toString(8)}; only 600 (owner read/write) is accepted.`,
    );
  }
}

/** Write one user message as an NDJSON line, after the ownership/permission check. */
export async function writeToInbox(path: string, content: string): Promise<void> {
  await checkInboxSocket(path);
  const line = `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`;
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ path });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out writing to ${path}.`));
    }, SOCKET_WRITE_TIMEOUT_MS);
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once("connect", () => {
      socket.end(line, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
}

export interface SenderSocket {
  path: string;
  close(): Promise<void>;
}

/**
 * The helper's own socket, named in the `from="uds:..."` attribute so the
 * provenance points at a real local endpoint. Replies are out of scope for now,
 * so incoming connections are closed straight away.
 */
export async function openSenderSocket(dir: string): Promise<SenderSocket> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  const uid = process.getuid?.();
  if (!info.isDirectory() || (uid !== undefined && info.uid !== uid)) {
    throw new Error(`${dir} is not a directory owned by the current user.`);
  }
  await chmod(dir, 0o700);
  const path = join(dir, `helper-${process.pid}.sock`);
  await rm(path, { force: true });
  const server: Server = createServer((connection) => connection.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      resolve();
    });
  });
  await chmod(path, OWNER_ONLY_MODE);
  return {
    path,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}
