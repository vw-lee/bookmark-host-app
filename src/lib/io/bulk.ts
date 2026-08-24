/**
 * Bulk operations over the whole collection (tasks 4e, 4f).
 *
 * All of these are pure functions returning a PLAN. Nothing here mutates the store: the UI
 * shows the plan, the user confirms, and only then is it applied. An operation that silently
 * rewrites hundreds of records is not one anybody should trigger by misclicking.
 */
import type { Bookmark } from "../schema/types";
import { normalizeTag, normalizeTags, tagMatches } from "../schema/normalize";

export interface DuplicateGroup {
  urlKey: string;
  /** The record that will survive — the oldest, so the original creation date is kept. */
  keep: Bookmark;
  /** Records that will be tombstoned, their tags merged into `keep`. */
  merge: Bookmark[];
  /** Union of every tag across the group. */
  mergedTags: string[];
}

/**
 * Find live records sharing a urlKey (task 4e).
 *
 * Duplicates should be rare — add-time dedupe (2g) catches most — but imports from several
 * sources, and records created before normalisation rules changed, can still collide.
 */
export function findDuplicates(bookmarks: Bookmark[]): DuplicateGroup[] {
  const byKey = new Map<string, Bookmark[]>();
  for (const b of bookmarks) {
    if (b.deletedAt || !b.urlKey) continue;
    const group = byKey.get(b.urlKey);
    if (group) group.push(b);
    else byKey.set(b.urlKey, [b]);
  }

  const groups: DuplicateGroup[] = [];
  for (const [urlKey, records] of byKey) {
    if (records.length < 2) continue;
    // ULIDs sort by creation time, so the smallest id is the oldest record.
    const sorted = [...records].sort((a, b) => (a.id < b.id ? -1 : 1));
    const keep = sorted[0]!;
    const merge = sorted.slice(1);
    groups.push({
      urlKey,
      keep,
      merge,
      mergedTags: normalizeTags(records.flatMap((r) => r.tags)),
    });
  }
  return groups.sort((a, b) => a.urlKey.localeCompare(b.urlKey));
}

/**
 * Apply a set of duplicate groups.
 *
 * The survivor absorbs every tag in the group and the longest description available — losing a
 * description the user wrote because it happened to be on the newer copy would be a poor trade
 * for tidiness.
 */
export function applyDedupe(
  bookmarks: Bookmark[],
  groups: DuplicateGroup[],
  now: string,
): Bookmark[] {
  const keepById = new Map(groups.map((g) => [g.keep.id, g]));
  const tombstone = new Set(groups.flatMap((g) => g.merge.map((m) => m.id)));

  return bookmarks.map((b) => {
    const group = keepById.get(b.id);
    if (group) {
      const all = [group.keep, ...group.merge];
      const description = all.map((r) => r.description).sort((x, y) => y.length - x.length)[0] ?? "";
      const notes = all.map((r) => r.notes).sort((x, y) => y.length - x.length)[0] ?? "";
      return {
        ...b,
        tags: group.mergedTags,
        description: b.description || description,
        notes: b.notes || notes,
        pinned: all.some((r) => r.pinned),
        updatedAt: now,
      };
    }
    if (tombstone.has(b.id)) return { ...b, deletedAt: now, updatedAt: now };
    return b;
  });
}

export interface TagPlan {
  /** How many records the operation touches. */
  affected: number;
  /** Sample of the resulting tag changes, for the preview. */
  examples: { from: string; to: string | null }[];
  /** Canonical forms that will collide and merge as a result. */
  collisions: string[];
}

/**
 * Rename a tag and everything beneath it (task 4f).
 *
 * A rename is a prefix replace across the whole collection: renaming `dev` to `engineering`
 * must carry `dev/rust` to `engineering/rust`, or the subtree is orphaned.
 */
export function planRename(bookmarks: Bookmark[], from: string, to: string): TagPlan {
  const source = normalizeTag(from);
  const target = normalizeTag(to);
  const examples: { from: string; to: string | null }[] = [];
  const collisions = new Set<string>();
  let affected = 0;

  if (!source || !target || source === target) return { affected: 0, examples: [], collisions: [] };

  for (const b of bookmarks) {
    if (b.deletedAt) continue;
    const matching = b.tags.filter((t) => tagMatches(t, source));
    if (matching.length === 0) continue;
    affected += 1;

    for (const tag of matching) {
      const renamed = normalizeTag(target + tag.slice(source.length));
      if (examples.length < 5 && !examples.some((e) => e.from === tag)) {
        examples.push({ from: tag, to: renamed });
      }
      // Renaming onto a tag that already exists merges the two.
      if (b.tags.includes(renamed)) collisions.add(renamed);
    }
  }

  return { affected, examples, collisions: [...collisions].sort() };
}

export function applyRename(
  bookmarks: Bookmark[],
  from: string,
  to: string,
  now: string,
): Bookmark[] {
  const source = normalizeTag(from);
  const target = normalizeTag(to);
  if (!source || !target || source === target) return bookmarks;

  return bookmarks.map((b) => {
    if (b.deletedAt || !b.tags.some((t) => tagMatches(t, source))) return b;
    const tags = normalizeTags(
      b.tags.map((t) => (tagMatches(t, source) ? target + t.slice(source.length) : t)),
    );
    return { ...b, tags, updatedAt: now };
  });
}

/** Remove a tag and its descendants from every record (task 4f). */
export function planDeleteTag(bookmarks: Bookmark[], tag: string): TagPlan {
  const source = normalizeTag(tag);
  if (!source) return { affected: 0, examples: [], collisions: [] };

  const examples: { from: string; to: string | null }[] = [];
  let affected = 0;

  for (const b of bookmarks) {
    if (b.deletedAt) continue;
    const matching = b.tags.filter((t) => tagMatches(t, source));
    if (matching.length === 0) continue;
    affected += 1;
    for (const t of matching) {
      if (examples.length < 5 && !examples.some((e) => e.from === t)) {
        examples.push({ from: t, to: null });
      }
    }
  }
  return { affected, examples, collisions: [] };
}

export function applyDeleteTag(bookmarks: Bookmark[], tag: string, now: string): Bookmark[] {
  const source = normalizeTag(tag);
  if (!source) return bookmarks;

  return bookmarks.map((b) => {
    if (b.deletedAt || !b.tags.some((t) => tagMatches(t, source))) return b;
    // Only the tag is removed — the bookmark itself is never deleted by a tag operation.
    return { ...b, tags: b.tags.filter((t) => !tagMatches(t, source)), updatedAt: now };
  });
}
