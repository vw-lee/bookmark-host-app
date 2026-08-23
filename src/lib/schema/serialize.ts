/**
 * Deterministic serialisation (§3.1).
 *
 * The storage layer is git. Byte-stable output means readable diffs, and — more importantly —
 * it means two devices that make the same logical change produce the same bytes, which removes
 * a whole class of spurious conflicts.
 *
 * Rules: keys sorted, bookmarks sorted by id (ULIDs sort by creation time), tags sorted,
 * two-space indent, trailing newline.
 */
import type { BookmarkFile, Bookmark, TagMeta } from "./types";

/** Field order within a bookmark. Fixed, so a record's diff is stable across writes. */
const BOOKMARK_KEYS: (keyof Bookmark)[] = [
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

const TAG_META_KEYS: (keyof TagMeta)[] = ["label", "color", "order"];

function orderedBookmark(b: Bookmark): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of BOOKMARK_KEYS) {
    out[key] = key === "tags" ? [...b.tags].sort() : b[key];
  }
  return out;
}

function orderedTagMeta(meta: Record<string, TagMeta>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const tag of Object.keys(meta).sort()) {
    const entry: Record<string, unknown> = {};
    for (const key of TAG_META_KEYS) {
      if (meta[tag]?.[key] !== undefined) entry[key] = meta[tag]![key];
    }
    out[tag] = entry;
  }
  return out;
}

/** Serialise to the canonical byte form. Same input always yields identical output. */
export function serialize(file: BookmarkFile): string {
  const ordered = {
    schemaVersion: file.schemaVersion,
    updatedAt: file.updatedAt,
    tagMeta: orderedTagMeta(file.tagMeta),
    bookmarks: [...file.bookmarks]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(orderedBookmark),
  };
  return JSON.stringify(ordered, null, 2) + "\n";
}
