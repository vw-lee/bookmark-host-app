/**
 * Core domain types. Mirrors README §3.
 *
 * Three distinct notions of identity live on a Bookmark and must not be conflated:
 *   - `id`     permanent record identity; what the merge algorithm matches on (§3.2)
 *   - `urlKey` logical identity ("is this the same link?"); drives dedupe on add (§3.1)
 *   - `url`    what the user actually navigates to; preserved verbatim
 */

/** Current on-disk schema version. Bump only alongside a migration in migrate.ts. */
export const SCHEMA_VERSION = 2;

export interface Bookmark {
  /** ULID. Permanent. Never rewritten, even if the URL changes. */
  id: string;
  /** Exactly what the user saved, tracking parameters and all. */
  url: string;
  /** Normalised dedupe key derived from `url`. See normalizeUrlKey(). */
  urlKey: string;
  title: string;
  description: string;
  notes: string;
  /** Canonical lowercase tags, `/`-delimited for hierarchy (§3.3). */
  tags: string[];
  /** Remote favicon URL, or null. Never a data: URI — see README §4.3. */
  favicon: string | null;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  /** Mandatory. Merge is impossible without it (§3.1). */
  updatedAt: string;
  /** Tombstone. A deleted record is retained, not removed (§3.1). */
  deletedAt: string | null;
  /** When the Phase 6 enrichment Action last filled this record in. */
  enrichedAt: string | null;
}

/** Presentation metadata for a tag. Never affects membership or matching. */
export interface TagMeta {
  color?: string;
  order?: number;
  /** Display case, e.g. "Dev/Rust" for the canonical key "dev/rust" (§3.3.3). */
  label?: string;
}

export interface BookmarkFile {
  schemaVersion: number;
  updatedAt: string;
  tagMeta: Record<string, TagMeta>;
  bookmarks: Bookmark[];
}

export function emptyFile(now: string = new Date().toISOString()): BookmarkFile {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: now, tagMeta: {}, bookmarks: [] };
}
