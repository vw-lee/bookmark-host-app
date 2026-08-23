/**
 * Normalisation for URLs (§3.1) and tags (§3.3.3).
 *
 * Both run on EVERY write path — manual entry, import, enrichment, migration — so that no two
 * spellings of the same thing can coexist in the file. There is deliberately one implementation
 * of each; duplicating them is how two boundaries drift apart.
 */

/** Query parameters that identify a campaign, not a document. */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^gbraid$/i,
  /^wbraid$/i,
  /^msclkid$/i,
  /^mc_(cid|eid)$/i,
  /^igshid$/i,
  /^ref$/i,
  /^ref_src$/i,
  /^si$/i,
];

const SAFE_SCHEMES = new Set(["http:", "https:"]);

/**
 * Control characters, stripped from any imported or scraped text (§5.4).
 *
 * Matching control characters is the entire purpose here — imported bookmark files and scraped
 * page metadata are full of them — so the rule is disabled for this one expression rather than
 * globally. Built from escapes so no literal control character appears in the source.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\u0000-\u001F\u007F]", "g");

/**
 * Is this URL safe to render as a clickable anchor? (§5.4)
 *
 * Enforced at BOTH the save boundary and the render boundary, sharing this one function, so a
 * `javascript:` URL cannot reach an href by any route.
 */
export function isSafeUrl(raw: string): boolean {
  try {
    return SAFE_SCHEMES.has(new URL(raw).protocol);
  } catch {
    return false;
  }
}

/**
 * Derive the logical identity of a link (§3.1).
 *
 * Scheme is deliberately excluded so http and https variants of one page collapse together.
 * Returns "" for anything unparseable or unsafe, which callers must treat as "cannot dedupe".
 */
export function normalizeUrlKey(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return "";
  }
  if (!SAFE_SCHEMES.has(u.protocol)) return "";

  const host = u.hostname.toLowerCase().replace(/^www\./, "");

  const params = new URLSearchParams(u.search);
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAMS.some((re) => re.test(key))) params.delete(key);
  }
  params.sort(); // ?b=2&a=1 and ?a=1&b=2 address the same document
  const query = params.toString();

  const path = u.pathname.replace(/\/+$/, "");

  // A fragment is dropped unless it looks like a SPA route (`#/inbox`), which addresses a
  // different document rather than a position within one.
  const isRouteFragment = u.hash.startsWith("#/") && u.hash.length > 2;
  const frag = isRouteFragment ? u.hash : "";

  const port = u.port && u.port !== "80" && u.port !== "443" ? `:${u.port}` : "";

  return `${host}${port}${path}${query ? `?${query}` : ""}${frag}`;
}

export const TAG_MAX_DEPTH = 5;
export const TAG_MAX_SEGMENT = 64;
export const TAG_MAX_LENGTH = 200;

/**
 * Canonical tag form (§3.3.3). Returns "" if the tag is empty or violates a limit; callers
 * drop empties rather than storing them.
 *
 * Step order matters: NFC must precede lowercasing, or the two byte-sequences for "café"
 * survive as two distinct tags that look identical in the sidebar.
 */
export function normalizeTag(raw: string): string {
  const segments = raw
    .normalize("NFC")
    .toLowerCase()
    .replace(CONTROL_CHARS, "")
    .split("/")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.length > 0);

  if (segments.length === 0) return "";
  if (segments.length > TAG_MAX_DEPTH) return "";
  if (segments.some((s) => s.length > TAG_MAX_SEGMENT)) return "";

  const joined = segments.join("/");
  return joined.length > TAG_MAX_LENGTH ? "" : joined;
}

/** Normalise a tag list, dropping invalid entries and duplicates, then sort for determinism. */
export function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>();
  for (const t of raw) {
    const n = normalizeTag(t);
    if (n) seen.add(n);
  }
  return [...seen].sort();
}

/** Strip control characters and cap length on free text from imports or enrichment (§5.4). */
export function cleanText(raw: string, maxLength: number): string {
  return raw.normalize("NFC").replace(CONTROL_CHARS, "").trim().slice(0, maxLength);
}

/**
 * Does `tag` fall under `selected`? (§3.3.2)
 *
 * The `+ "/"` is load-bearing: a bare startsWith would match "development" when "dev" is
 * selected.
 */
export function tagMatches(tag: string, selected: string): boolean {
  return tag === selected || tag.startsWith(selected + "/");
}

/** Expand stored tags into the derived ancestor nodes the tree renders (§3.3.1). */
export function derivedTagNodes(tags: Iterable<string>): string[] {
  const nodes = new Set<string>();
  for (const tag of tags) {
    const parts = tag.split("/");
    for (let i = 1; i <= parts.length; i++) nodes.add(parts.slice(0, i).join("/"));
  }
  return [...nodes].sort();
}
