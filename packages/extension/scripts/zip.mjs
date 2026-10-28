/**
 * A minimal, deterministic zip writer: entries sorted by path, every timestamp fixed, no
 * extra fields, deflated at a fixed level. The same files always give the same bytes, so a
 * build can be checked against another by its hash.
 */

import { Buffer } from "node:buffer";
import { crc32, deflateRawSync } from "node:zlib";

/** 1980-01-01 00:00, the earliest time a zip can record. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const VERSION = 20;
const UTF8_FLAG = 0x0800;
const DEFLATE = 8;
const STORE = 0;

/**
 * @param {readonly { path: string; data: Uint8Array }[]} files
 * @returns {Buffer}
 */
export function zipFiles(files) {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { path, data } of sorted) {
    if (path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error(`Refusing to zip ${path}`);
    }
    const name = Buffer.from(path, "utf8");
    const deflated = deflateRawSync(data, { level: 9 });
    const deflate = deflated.length < data.length;
    const body = deflate ? deflated : Buffer.from(data);
    const method = deflate ? DEFLATE : STORE;
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
