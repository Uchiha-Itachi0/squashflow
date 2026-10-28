/** Normalise a git remote URL (SSH, HTTPS, git://) to its host and owner/name. */

export interface RepoRef {
  host: string;
  owner: string;
  name: string;
  /** `owner/name` for github.com, `host/owner/name` elsewhere. */
  fullName: string;
}

const SCP_LIKE = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/;
const SEGMENT = /^[A-Za-z0-9_.-]+$/;

export function normaliseRemoteUrl(raw: string): RepoRef | null {
  const remote = raw.trim();
  if (remote === "") return null;
  const parsed = parseUrlForm(remote) ?? parseScpForm(remote);
  if (!parsed) return null;
  const segments = parsed.path
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "")
    .split("/");
  if (segments.length !== 2) return null;
  const [owner, name] = segments as [string, string];
  if (!SEGMENT.test(owner) || !SEGMENT.test(name) || name === "." || name === "..") return null;
  const host = parsed.host.toLowerCase();
  const fullName = host === "github.com" ? `${owner}/${name}` : `${host}/${owner}/${name}`;
  return { host, owner, name, fullName };
}

function parseUrlForm(remote: string): { host: string; path: string } | null {
  if (!/^(https?|ssh|git|git\+ssh):\/\//i.test(remote)) return null;
  try {
    const url = new URL(remote);
    if (url.hostname === "") return null;
    return { host: url.hostname, path: decodeURIComponent(url.pathname) };
  } catch {
    return null;
  }
}

function parseScpForm(remote: string): { host: string; path: string } | null {
  if (remote.includes("://")) return null;
  const match = SCP_LIKE.exec(remote);
  if (!match) return null;
  return { host: match[1] ?? "", path: match[2] ?? "" };
}
