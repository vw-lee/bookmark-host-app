/**
 * Search query parsing (task 7h).
 *
 * The old search was a substring test across four fields, and the tag filter was a single
 * selected node. Between them there was no way to express "rust AND book", or "everything from
 * this domain", or the question that actually matters after importing 300 browser bookmarks:
 * "which of these have no tags yet".
 *
 * The syntax is the one people already know from GitHub and Gmail, because a query language
 * nobody can guess is worse than no query language:
 *
 *   tag:dev/rust        has this tag, or a descendant of it (§3.3.2)
 *   site:example.com    the host contains this
 *   is:pinned           pinned records only
 *   is:untagged         records with no tags at all
 *   -tag:archive        any of the above, negated
 *   plain words         substring match across title, URL, description and tags
 *
 * Every clause is ANDed, including repeats: `tag:rust tag:book` means both. That is the whole
 * point of the feature, so OR is deliberately absent — it doubles the syntax to serve a query
 * nobody has asked for, and `tag:parent` already covers the common "any of these" case through
 * the tag hierarchy.
 *
 * Anything that looks like an operator but is not one — `foo:bar` — falls back to being a plain
 * search word. Silently matching nothing would look like a bug in the data.
 */

import type { Bookmark } from "./types";
import { tagMatches } from "./normalize";

/** The flags `is:` accepts. Unknown values fall back to plain text, so this list is the contract. */
export const IS_FLAGS = ["pinned", "untagged"] as const;
export type IsFlag = (typeof IS_FLAGS)[number];

export interface Clause<T> {
  value: T;
  /** Prefixed with "-": the record must NOT match. */
  negated: boolean;
}

export interface ParsedQuery {
  /** Free text, lowercased. Every word must appear somewhere in the record. */
  words: Clause<string>[];
  tags: Clause<string>[];
  sites: Clause<string>[];
  flags: Clause<IsFlag>[];
}

const EMPTY: ParsedQuery = { words: [], tags: [], sites: [], flags: [] };

/** Is this query going to filter anything at all? */
export function isEmptyQuery(parsed: ParsedQuery): boolean {
  return (
    parsed.words.length === 0 &&
    parsed.tags.length === 0 &&
    parsed.sites.length === 0 &&
    parsed.flags.length === 0
  );
}

function isFlag(value: string): value is IsFlag {
  return (IS_FLAGS as readonly string[]).includes(value);
}

/**
 * Split on whitespace, honouring double quotes so `tag:"reading list"` and multi-word phrases
 * survive. An unclosed quote takes the rest of the string rather than being dropped — someone
 * mid-type should see results narrowing, not the query silently reverting.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;

  for (const char of input) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

export function parseQuery(input: string): ParsedQuery {
  const trimmed = input.trim();
  if (!trimmed) return EMPTY;

  const parsed: ParsedQuery = { words: [], tags: [], sites: [], flags: [] };

  for (const raw of tokenize(trimmed)) {
    const negated = raw.startsWith("-") && raw.length > 1;
    const token = negated ? raw.slice(1) : raw;
    const colon = token.indexOf(":");

    if (colon > 0) {
      const key = token.slice(0, colon).toLowerCase();
      const value = token.slice(colon + 1).toLowerCase();

      if (value) {
        if (key === "tag") {
          parsed.tags.push({ value, negated });
          continue;
        }
        if (key === "site" || key === "host") {
          parsed.sites.push({ value, negated });
          continue;
        }
        if (key === "is" && isFlag(value)) {
          parsed.flags.push({ value, negated });
          continue;
        }
      }
    }

    // Not an operator — a plain word. The leading "-" is kept off, so `-rust` excludes.
    parsed.words.push({ value: token.toLowerCase(), negated });
  }

  return parsed;
}

/** The host of a URL, lowercased, or "" when it cannot be parsed. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function matchesWord(bookmark: Bookmark, word: string): boolean {
  return (
    bookmark.title.toLowerCase().includes(word) ||
    bookmark.url.toLowerCase().includes(word) ||
    bookmark.description.toLowerCase().includes(word) ||
    bookmark.tags.some((t) => t.includes(word))
  );
}

function matchesFlag(bookmark: Bookmark, flag: IsFlag): boolean {
  switch (flag) {
    case "pinned":
      return bookmark.pinned;
    case "untagged":
      return bookmark.tags.length === 0;
  }
}

/** Does one record satisfy every clause? */
export function matchesQuery(bookmark: Bookmark, parsed: ParsedQuery): boolean {
  const host = parsed.sites.length > 0 ? hostOf(bookmark.url) : "";

  for (const { value, negated } of parsed.words) {
    if (matchesWord(bookmark, value) === negated) return false;
  }
  for (const { value, negated } of parsed.tags) {
    // Descendant-inclusive, so tag:dev finds dev/rust — the same rule the sidebar uses (§3.3.2).
    if (bookmark.tags.some((t) => tagMatches(t, value)) === negated) return false;
  }
  for (const { value, negated } of parsed.sites) {
    if (host.includes(value) === negated) return false;
  }
  for (const { value, negated } of parsed.flags) {
    if (matchesFlag(bookmark, value) === negated) return false;
  }
  return true;
}
