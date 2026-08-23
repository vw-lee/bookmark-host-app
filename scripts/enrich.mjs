/**
 * Metadata enrichment (task 6a).
 *
 * Browsers cannot fetch arbitrary pages for metadata — CORS blocks it — so this runs in the
 * repository instead, on commit. It costs nothing and needs no infrastructure (§12).
 *
 * Everything it writes is UNTRUSTED (task 6e): the titles and descriptions come from arbitrary
 * third-party sites. They are control-character stripped and length-capped here, and validated
 * again by the app on load. Our own workflow's output is not trusted merely because it is ours.
 *
 * Usage: node scripts/enrich.mjs <path-to-bookmarks.json>
 * Exit 0 always, unless the file itself is unreadable — a site being down is not a build
 * failure.
 */
import { readFile, writeFile } from "node:fs/promises";
import { serialize, cleanText, extractMetadata } from "./lib/bookmarks.mjs";

const FETCH_TIMEOUT_MS = 10_000;
/** Cap per run so one invocation cannot hang for hours on a large import. */
const MAX_PER_RUN = 40;
/** Be a polite client to the sites we scrape. */
const DELAY_BETWEEN_MS = 250;
const USER_AGENT = "bookmark-manager-enrichment/1.0 (+https://github.com)";

const path = process.argv[2] ?? "data/bookmarks.json";

async function fetchMetadata(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) return null;

    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;

    // Read a bounded prefix. A hostile or broken server could otherwise stream forever.
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks = [];
    let total = 0;
    while (total < 500_000) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    await reader.cancel().catch(() => {});

    const html = new TextDecoder("utf-8", { fatal: false }).decode(concat(chunks, total));
    return extractMetadata(html, response.url || url);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function concat(chunks, total) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const raw = await readFile(path, "utf8");
const file = JSON.parse(raw);

const pending = file.bookmarks
  .filter((b) => !b.deletedAt && b.enrichedAt === null)
  .slice(0, MAX_PER_RUN);

if (pending.length === 0) {
  console.log("enrich: nothing to do");
  process.exit(0);
}

console.log(`enrich: ${pending.length} bookmark(s) to enrich`);
let changed = 0;

for (const bookmark of pending) {
  const meta = await fetchMetadata(bookmark.url);
  const now = new Date().toISOString();

  // Marked as attempted either way. Without this a permanently dead link would be refetched
  // on every single commit, forever.
  bookmark.enrichedAt = now;

  if (!meta) {
    console.log(`  · ${bookmark.url} — unreachable`);
    changed += 1;
    continue;
  }

  // Never overwrite what the user wrote. Enrichment fills gaps; it does not correct people.
  const hadTitle = bookmark.title && bookmark.title !== new URL(bookmark.url).hostname;
  if (!hadTitle && meta.title) bookmark.title = cleanText(meta.title, 500);
  if (!bookmark.description && meta.description) {
    bookmark.description = cleanText(meta.description, 2000);
  }
  if (!bookmark.favicon && meta.favicon) bookmark.favicon = meta.favicon;

  bookmark.updatedAt = now;
  changed += 1;
  console.log(`  · ${bookmark.url} — ${bookmark.title.slice(0, 60)}`);

  await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MS));
}

if (changed > 0) {
  file.updatedAt = new Date().toISOString();
  const serialized = serialize(file);
  if (serialized !== raw) {
    await writeFile(path, serialized, "utf8");
    console.log(`enrich: updated ${changed} bookmark(s)`);
    process.exit(0);
  }
}

console.log("enrich: no changes written");
