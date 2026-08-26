/**
 * Generated domain tiles (task 7g).
 *
 * A card grid needs a visual anchor per item or it reads as a wall of text. The obvious source
 * is a favicon or an og:image, and both were rejected: the app currently issues no request to
 * any host but api.github.com, and a grid of remote images would tell two dozen third parties
 * the user's IP every time the page paints. Storing images instead is worse — that is the 1 MB
 * ceiling (§4.3) reached on the first card.
 *
 * So the tile is *derived* from the URL. Same site, same colour, every device, forever, with no
 * network and no bytes in the file. It is the §3.3.1 trick applied to presentation: a projection
 * cannot drift, because there is nothing to drift from.
 */

/** Colour is decoration; the letters carry the identity. E-ink strips the fill entirely. */
export interface Tile {
  /** One or two uppercase characters. Never empty. */
  initials: string;
  /** 0–359, deterministic in the site name. */
  hue: number;
  /** Display host, `www.` stripped. Empty when the URL will not parse. */
  host: string;
}

/**
 * Second-level labels that are part of a public suffix rather than a site name, so
 * `example.co.uk` yields "E" and not "C". Deliberately a short list rather than the full
 * Public Suffix List — that is a 200 KB dependency to improve two letters on a tile.
 */
const PUBLIC_SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "or", "ne"]);

/**
 * FNV-1a. Chosen over summing char codes because anagram-ish hostnames ("apple"/"appel") must
 * not collide onto the same colour, and over any crypto hash because this must stay synchronous.
 */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    // Math.imul keeps the multiply in 32-bit range; a plain * would lose precision above 2^53.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The label that names the site: `news.ycombinator.com` -> `ycombinator`.
 *
 * Subdomains are dropped deliberately. A tile identifies a site, and `developer.mozilla.org`
 * and `bugzilla.mozilla.org` being the same colour is a feature — they are the same place.
 */
export function siteLabel(host: string): string {
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 1) return labels[0] ?? "";
  const last = labels.length - 1;
  const candidate = labels[last - 1] ?? "";
  // `example.co.uk`: step past the public second level to the real name.
  if (labels.length >= 3 && PUBLIC_SECOND_LEVEL.has(candidate)) return labels[last - 2] ?? candidate;
  return candidate;
}

/**
 * Up to two letters from a site label. `rust-lang` -> "RL", `ycombinator` -> "Y".
 *
 * Multi-word hosts get both initials because that is what makes them distinguishable at a
 * glance; single words get one letter, since "YC" for `ycombinator` would be inventing an
 * abbreviation the user never wrote.
 */
export function initialsFor(label: string): string {
  const words = label.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const first = words[0];
  if (!first) return "?";
  const second = words[1];
  // Spread rather than [0] so an astral character counts as one letter, not half a surrogate.
  const head = [...first][0] ?? "?";
  if (!second) return head.toUpperCase();
  return (head + ([...second][0] ?? "")).toUpperCase();
}

/** Everything a tile needs, derived from a URL. Never throws — a bad URL yields a "?" tile. */
export function tileFor(url: string): Tile {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // An unparseable or non-http URL still has to render something rather than break the grid.
    return { initials: "?", hue: 0, host: "" };
  }
  const label = siteLabel(host);
  return {
    initials: label ? initialsFor(label) : "?",
    // Hash the site label, not the full host, so subdomains share their parent's colour.
    hue: hash(label || host) % 360,
    host,
  };
}

/**
 * The fill.
 *
 * oklch rather than hsl because its lightness is perceptually uniform: at a fixed L every hue
 * lands at the same contrast against white text. In hsl, `hsl(60 55% 48%)` (yellow) and
 * `hsl(240 55% 48%)` (blue) differ by roughly 3:1 in luminance, so one of them would always be
 * failing contrast. L=0.48 holds white text above 4.5:1 across the whole wheel.
 */
export function tileColor(hue: number): string {
  return `oklch(0.48 0.14 ${hue})`;
}
