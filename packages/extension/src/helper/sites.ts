/**
 * Which repository a site belongs to, as the user picked and chose to remember it.
 * Keyed by origin (`https://example.com`), kept in extension local storage. Without a
 * dev overlay this is how a page is matched to the sessions working on its code.
 */

// Namespace import: Parcel (the extension bundler) mis-bundles zod's `z` re-export.
import * as z from "zod";
import type { StorageAreaLike } from "../store/pins";

const SITES_KEY = "site-repos";
/** Enough for anyone's sites; stops the record growing without bound. */
const MAX_SITES = 500;

/** `owner/repo`, or `host/owner/repo` off GitHub, as the helper reports it. */
export const repoNameSchema = z
  .string()
  .max(300)
  .regex(/^[\w.:-]+(\/[\w.-]+){1,2}$/)
  .refine((name) => name.split("/").every((part) => !/^\.+$/.test(part)), "not a repository");

const sitesSchema = z.record(z.string().max(300), repoNameSchema);

/** The site a page belongs to: its origin. */
export function siteOf(pageUrl: string): string {
  return new URL(pageUrl).origin;
}

export class SiteRepoStore {
  constructor(private readonly area: StorageAreaLike) {}

  async get(pageUrl: string): Promise<string | null> {
    return (await this.all())[siteOf(pageUrl)] ?? null;
  }

  /** Remember `repo` for the page's site, or forget the site when `repo` is null. */
  async set(pageUrl: string, repo: string | null): Promise<void> {
    const site = siteOf(pageUrl);
    const others = Object.fromEntries(
      Object.entries(await this.all()).filter(([key]) => key !== site),
    );
    if (repo === null) {
      await this.write(others);
      return;
    }
    if (Object.keys(others).length >= MAX_SITES) {
      throw new Error(`Squashflow remembers at most ${MAX_SITES} sites. Forget one first.`);
    }
    await this.write({ ...others, [site]: repoNameSchema.parse(repo) });
  }

  private async all(): Promise<Record<string, string>> {
    const parsed = sitesSchema.safeParse((await this.area.get(SITES_KEY))[SITES_KEY]);
    return parsed.success ? parsed.data : {};
  }

  private async write(sites: Record<string, string>): Promise<void> {
    if (Object.keys(sites).length === 0) await this.area.remove(SITES_KEY);
    else await this.area.set({ [SITES_KEY]: sites });
  }
}
