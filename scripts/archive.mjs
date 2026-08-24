/**
 * Wayback Machine archival (task 6d).
 *
 * Optional, and off by default — see archive.yml. Submitting a URL to the Internet Archive
 * makes the fact that you bookmarked it publicly observable, which is a meaningful change for a
 * collection whose whole premise is a PRIVATE repository (§5.3). It is opt-in for that reason.
 *
 * Read-only with respect to bookmarks.json: it submits and reports, and never edits the file.
 *
 * Usage: node scripts/archive.mjs <path-to-bookmarks.json> [--days N]
 */
import { readFile } from "node:fs/promises";

const TIMEOUT_MS = 30_000;
const DELAY_MS = 6000; // the Save Page Now endpoint is rate limited; be a good citizen
const USER_AGENT = "bookmark-manager-archive/1.0 (+https://github.com)";

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--")) ?? "data/bookmarks.json";
const daysArg = args.indexOf("--days");
const days = daysArg >= 0 ? Number(args[daysArg + 1]) : 7;

const file = JSON.parse(await readFile(path, "utf8"));
const cutoff = Date.now() - days * 86_400_000;

// Only recently added links, so a scheduled run does not resubmit the whole collection.
const recent = file.bookmarks.filter(
  (b) => !b.deletedAt && !b.archived && Date.parse(b.createdAt) >= cutoff,
);

console.log(`## Wayback archival\n`);
if (recent.length === 0) {
  console.log(`No bookmarks added in the last ${days} day(s).`);
  process.exit(0);
}

let saved = 0;
let failed = 0;

for (const bookmark of recent) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`https://web.archive.org/save/${bookmark.url}`, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    if (response.ok) {
      saved += 1;
      console.log(`- saved: ${bookmark.url}`);
    } else {
      failed += 1;
      console.log(`- failed (HTTP ${response.status}): ${bookmark.url}`);
    }
  } catch (error) {
    failed += 1;
    console.log(`- failed (${error.name === "AbortError" ? "timeout" : "unreachable"}): ${bookmark.url}`);
  } finally {
    clearTimeout(timer);
  }
  await new Promise((r) => setTimeout(r, DELAY_MS));
}

console.log(`\nSubmitted ${recent.length}: ${saved} saved, ${failed} failed.`);
