/**
 * Dead-link report (task 6c).
 *
 * Deliberately read-only. It reports; it never edits bookmarks.json. A 404 today can be a site
 * outage, a rate limit, or a bot wall — deleting someone's bookmark on that evidence would be
 * worse than leaving a dead link in place.
 *
 * Usage: node scripts/linkcheck.mjs <path-to-bookmarks.json>
 */
import { readFile } from "node:fs/promises";

const TIMEOUT_MS = 10_000;
const CONCURRENCY = 6;
const USER_AGENT = "bookmark-manager-linkcheck/1.0 (+https://github.com)";

const path = process.argv[2] ?? "data/bookmarks.json";
const file = JSON.parse(await readFile(path, "utf8"));
const live = file.bookmarks.filter((b) => !b.deletedAt && !b.archived);

async function check(bookmark) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // HEAD first — cheaper, and most servers support it. Some reject it, so fall back to GET.
    let response = await fetch(bookmark.url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(bookmark.url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
      });
    }
    // 401/403 usually means a paywall or bot wall, not a dead page.
    const dead = response.status >= 400 && response.status !== 401 && response.status !== 403;
    return dead ? { bookmark, reason: `HTTP ${response.status}` } : null;
  } catch (error) {
    return { bookmark, reason: error.name === "AbortError" ? "timed out" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

const queue = [...live];
const failures = [];

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const result = await check(queue.shift());
      if (result) failures.push(result);
    }
  }),
);

console.log(`## Link check\n`);
console.log(`Checked ${live.length} link(s). ${failures.length} need attention.\n`);

if (failures.length > 0) {
  console.log(`| Bookmark | URL | Problem |`);
  console.log(`| --- | --- | --- |`);
  for (const { bookmark, reason } of failures.sort((a, b) => (a.reason < b.reason ? -1 : 1))) {
    const title = bookmark.title.replace(/\|/g, "\\|").slice(0, 80);
    console.log(`| ${title} | ${bookmark.url.slice(0, 100)} | ${reason} |`);
  }
}
