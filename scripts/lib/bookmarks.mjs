/**
 * Shared helpers for the GitHub Actions in .github/workflows (Phase 6).
 *
 * DRIFT WARNING: this duplicates the serialisation and sanitisation rules from
 * src/lib/schema/. It has to — the workflows run in plain Node with no build step, and the
 * app's modules use extensionless TypeScript imports that Node cannot resolve.
 *
 * The duplication is made safe by scripts/lib/parity.test.ts, which runs both implementations
 * over the same fixtures and fails if they disagree. If you change one, that test will tell you
 * to change the other.
 */

// Matching control characters is the point — imported and scraped text is full of them.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]", "g");

/** Mirrors cleanText() in src/lib/schema/normalize.ts. */
export function cleanText(raw, maxLength) {
  return String(raw ?? "")
    .normalize("NFC")
    .replace(CONTROL_CHARS, "")
    .trim()
    .slice(0, maxLength);
}

const BOOKMARK_KEYS = [
  "id",
  "url",
  "urlKey",
  "title",
  "description",
  "notes",
  "tags",
  "favicon",
  "pinned",
  "archived",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "enrichedAt",
];

const TAG_META_KEYS = ["label", "color", "order"];

/** Mirrors serialize() in src/lib/schema/serialize.ts. Byte-for-byte identical output. */
export function serialize(file) {
  const orderedTagMeta = {};
  for (const tag of Object.keys(file.tagMeta ?? {}).sort()) {
    const entry = {};
    for (const key of TAG_META_KEYS) {
      if (file.tagMeta[tag]?.[key] !== undefined) entry[key] = file.tagMeta[tag][key];
    }
    orderedTagMeta[tag] = entry;
  }

  const ordered = {
    schemaVersion: file.schemaVersion,
    updatedAt: file.updatedAt,
    tagMeta: orderedTagMeta,
    bookmarks: [...file.bookmarks]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((b) => {
        const out = {};
        for (const key of BOOKMARK_KEYS) {
          out[key] = key === "tags" ? [...b.tags].sort() : b[key];
        }
        return out;
      }),
  };

  return JSON.stringify(ordered, null, 2) + "\n";
}

/**
 * Extract metadata from a fetched HTML page.
 *
 * Regex rather than a DOM parser, deliberately: this runs over arbitrary third-party HTML in a
 * context with write access to the user's repository, and the output is treated as untrusted
 * either way (§5.4). Nothing here interprets the page — it only reads text out of it, and
 * every value is length-capped and control-character stripped before it is returned.
 */
export function extractMetadata(html, baseUrl) {
  const head = html.slice(0, 200_000); // metadata lives at the top; do not scan megabytes

  const ogTitle = matchContent(head, /<meta[^>]+property=["']og:title["'][^>]*>/i);
  // Bound generously, then cap with cleanText. A tight bound here would make an over-long
  // title fail to match at all, dropping it entirely rather than truncating it — which is how
  // a page with a runaway <title> would silently get no title.
  const titleTag = head.match(/<title[^>]*>([\s\S]{0,20000}?)<\/title>/i)?.[1];
  const title = cleanText(decodeEntities(ogTitle ?? titleTag ?? ""), 500);

  const ogDesc = matchContent(head, /<meta[^>]+property=["']og:description["'][^>]*>/i);
  const metaDesc = matchContent(head, /<meta[^>]+name=["']description["'][^>]*>/i);
  const description = cleanText(decodeEntities(ogDesc ?? metaDesc ?? ""), 2000);

  return { title, description, favicon: resolveFavicon(head, baseUrl) };
}

function matchContent(html, tagPattern) {
  const tag = html.match(tagPattern)?.[0];
  if (!tag) return null;
  return tag.match(/content=["']([\s\S]*?)["']/i)?.[1] ?? null;
}

function resolveFavicon(head, baseUrl) {
  const link = head.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i)?.[0];
  const href = link?.match(/href=["']([^"']+)["']/i)?.[1];

  // A declared icon that is not http(s) is discarded rather than stored: a data: URI would
  // inflate the file toward the 1 MB ceiling very quickly (§4.3). Real pages do this —
  // example.com declares `<link rel="icon" href="data:,">` — so falling back to the
  // conventional path is better than giving up and storing nothing.
  return httpUrl(href, baseUrl) ?? httpUrl("/favicon.ico", baseUrl);
}

function httpUrl(href, baseUrl) {
  if (!href) return null;
  try {
    const resolved = new URL(href, baseUrl);
    return resolved.protocol === "https:" || resolved.protocol === "http:" ? resolved.href : null;
  } catch {
    return null;
  }
}

function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&"); // last, so &amp;lt; does not become <
}
