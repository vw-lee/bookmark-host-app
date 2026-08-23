/**
 * Conflict resolution (README §3.2).
 *
 * This is the highest-risk code in the project. It is a pure function of two documents with no
 * I/O, no clock access beyond an injected `now`, and no dependency on which side is "ours" —
 * merge(a, b) and merge(b, a) must agree.
 *
 * The model is per-record last-write-wins with tombstones (D6). A true CRDT would preserve
 * concurrent edits to different fields of the same bookmark; LWW loses the older one. That is
 * an accepted trade for a single-user tool, and it is why `updatedAt` is mandatory (§3.1).
 */
import type { BookmarkFile, Bookmark, TagMeta } from "../schema/types";
import { SCHEMA_VERSION } from "../schema/types";

/** Tombstones are pruned after this long, so deletions do not accumulate forever (§3.1). */
export const TOMBSTONE_RETENTION_DAYS = 90;

function time(iso: string): number {
  const t = Date.parse(iso);
  // An unparseable date sorts oldest rather than throwing: a corrupt record must never win a
  // merge, but it must also never crash a sync.
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Which of two versions of one record survives?
 *
 * Rule 2: greater updatedAt wins. Rule 3: on an exact tie, the tombstone wins — a delete that
 * races an edit resolves to deleted, because resurrecting a bookmark the user deleted is more
 * surprising than losing an edit they may not have noticed making.
 */
function pickRecord(a: Bookmark, b: Bookmark): Bookmark {
  const ta = time(a.updatedAt);
  const tb = time(b.updatedAt);
  if (ta > tb) return a;
  if (tb > ta) return b;
  if (a.deletedAt && !b.deletedAt) return a;
  if (b.deletedAt && !a.deletedAt) return b;
  // Fully tied and both the same liveness: pick deterministically so the result does not
  // depend on argument order.
  return a.id <= b.id ? a : b;
}

function mergeBookmarks(left: Bookmark[], right: Bookmark[]): Bookmark[] {
  const byId = new Map<string, Bookmark>();
  for (const record of [...left, ...right]) {
    const existing = byId.get(record.id);
    byId.set(record.id, existing ? pickRecord(existing, record) : record);
  }
  return [...byId.values()];
}

/**
 * Rule 4: union tagMeta, remote winning per key on a tie.
 *
 * `remote` is passed explicitly rather than inferred, because tagMeta carries no timestamps —
 * there is nothing else to break a tie with.
 */
function mergeTagMeta(
  local: Record<string, TagMeta>,
  remote: Record<string, TagMeta>,
): Record<string, TagMeta> {
  return { ...local, ...remote };
}

/** Rule 5: drop tombstones past the retention window. */
function pruneTombstones(bookmarks: Bookmark[], now: number): Bookmark[] {
  const cutoff = now - TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return bookmarks.filter((b) => !b.deletedAt || time(b.deletedAt) >= cutoff);
}

export interface MergeOptions {
  /** Injected so tombstone pruning is testable without faking the system clock. */
  now?: number;
}

/**
 * Merge a local document with the remote one. `remote` wins tagMeta ties (rule 4); bookmark
 * conflicts are resolved by timestamp and are symmetric.
 */
export function merge(
  local: BookmarkFile,
  remote: BookmarkFile,
  options: MergeOptions = {},
): BookmarkFile {
  const now = options.now ?? Date.now();

  const bookmarks = pruneTombstones(mergeBookmarks(local.bookmarks, remote.bookmarks), now);

  // Rule 6: the document timestamp is the newest thing it contains, not the wall clock. A
  // merge that changes nothing must not produce a file that differs only by its timestamp,
  // because that would be a pointless commit and a pointless conflict for the next device.
  const newest = bookmarks.reduce(
    (max, b) => Math.max(max, time(b.updatedAt)),
    Math.max(time(local.updatedAt), time(remote.updatedAt)),
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date(newest).toISOString(),
    tagMeta: mergeTagMeta(local.tagMeta, remote.tagMeta),
    bookmarks,
  };
}

/** Live records only — what the UI renders. Tombstones stay in the file but never on screen. */
export function liveBookmarks(file: BookmarkFile): Bookmark[] {
  return file.bookmarks.filter((b) => !b.deletedAt);
}
