/** Minimal dotted-version handling for the Claude Code version check. */

export type Version = readonly [number, number, number];

export function parseVersion(text: string): Version | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

export function meetsMinimum(found: string, minimum: string): boolean {
  const foundVersion = parseVersion(found);
  const minimumVersion = parseVersion(minimum);
  if (!foundVersion || !minimumVersion) return false;
  return compareVersions(foundVersion, minimumVersion) >= 0;
}
