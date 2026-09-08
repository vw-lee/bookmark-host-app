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

// ------------------------------------------------------- batch rename (7p)

/** One row of the batch rename table. Raw user text; normalisation happens in the plan. */
export interface RenameRule {
  from: string;
  to: string;
}

/** Why a row will do nothing, or null if it will. */
export type RuleProblem = "empty" | "same" | "duplicate" | "no-match";

export interface BatchRenameRow {
  /** Index into the rules array, so the UI can line a row up with its input. */
  index: number;
  /** Canonical source and target, or "" when the row is still blank. */
  source: string;
  target: string;
  /** How many bookmarks this row alone rewrites. */
  affected: number;
  /** Sample of the tag-level changes it makes. */
  examples: { from: string; to: string }[];
  /** Canonical tags this row merges into something that already exists. */
  collisions: string[];
  problem: RuleProblem | null;
}

export interface BatchRenamePlan {
  rows: BatchRenameRow[];
  /** Distinct bookmarks touched by the batch as a whole — not the sum of the rows. */
  affected: number;
  /** How many rows will actually do something. */
  applicable: number;
}

interface CompiledRule {
  index: number;
  source: string;
  target: string;
}

/**
 * Validate the rows and drop the ones that cannot act.
 *
 * A blank row is not an error — the table always carries one for typing into — so it is
 * reported as a problem the UI can render as "nothing yet" rather than as a failure.
 */
function compileRules(rules: RenameRule[]): {
  compiled: CompiledRule[];
  problems: (RuleProblem | null)[];
} {
  const compiled: CompiledRule[] = [];
  const problems: (RuleProblem | null)[] = [];
  const claimed = new Set<string>();

  rules.forEach((rule, index) => {
    const source = normalizeTag(rule.from);
    const target = normalizeTag(rule.to);

    if (!source || !target) {
      problems[index] = "empty";
    } else if (source === target) {
      // Usually a canonicalisation the user did not realise had already happened:
      // "Reading List" and "reading-list" normalise to the same tag.
      problems[index] = "same";
    } else if (claimed.has(source)) {
      // Two rows renaming the same tag to different things has no defensible answer, so the
      // first row wins and the second is called out rather than silently losing.
      problems[index] = "duplicate";
    } else {
      claimed.add(source);
      problems[index] = null;
      compiled.push({ index, source, target });
    }
  });

  return { compiled, problems };
}

/**
 * Rewrite one tag under the whole rule set, or return null if no rule touches it.
 *
 * ## The rule that makes a batch safe: one pass, longest match wins
 *
 * Applying renames one after another chains them. With `dev` to `engineering` and
 * `engineering` to `eng`, a sequential batch turns `dev` into `eng` — an outcome nobody asked
 * for and no preview could honestly show, because it depends on the order of two rows the
 * user thinks of as independent.
 *
 * So every tag is matched against the ORIGINAL rules exactly once, and never re-examined.
 * Where several rules match — `dev` and `dev/rust` both match the tag `dev/rust` — the most
 * specific source wins, which is the only reading under which writing a more specific row
 * means anything at all. Row order is then irrelevant, and the preview is exact.
 */
function rewriteTag(
  tag: string,
  compiled: CompiledRule[],
): { rule: CompiledRule; to: string } | null {
  let best: CompiledRule | null = null;
  for (const rule of compiled) {
    if (!tagMatches(tag, rule.source)) continue;
    if (!best || rule.source.length > best.source.length) best = rule;
  }
  if (!best) return null;
  return { rule: best, to: normalizeTag(best.target + tag.slice(best.source.length)) };
}

/**
 * Preview a whole table of renames (task 7p).
 *
 * `affected` counts distinct bookmarks, not the sum of the per-row counts: one bookmark tagged
 * both `dev` and `readinglist` is rewritten once by a batch that renames both, and reporting
 * "2 bookmarks affected" for a collection of one would be a lie at exactly the moment the user
 * is deciding whether to trust the button.
 */
export function planBatchRename(bookmarks: Bookmark[], rules: RenameRule[]): BatchRenamePlan {
  const { compiled, problems } = compileRules(rules);

  const affectedByRule = new Map<number, number>();
  const examplesByRule = new Map<number, { from: string; to: string }[]>();
  const collisionsByRule = new Map<number, Set<string>>();
  let affected = 0;

  const collide = (index: number, tag: string) => {
    const owner = collisionsByRule.get(index) ?? new Set<string>();
    owner.add(tag);
    collisionsByRule.set(index, owner);
  };

  for (const b of bookmarks) {
    if (b.deletedAt) continue;

    const touched = new Set<number>();
    // Tags no rule renames. A rename landing on one of these is a merge, not a move.
    const untouched = new Set<string>();
    const produced = new Map<string, number>();

    for (const tag of b.tags) {
      const hit = rewriteTag(tag, compiled);
      if (!hit) {
        untouched.add(tag);
        continue;
      }
      touched.add(hit.rule.index);

      const examples = examplesByRule.get(hit.rule.index) ?? [];
      if (examples.length < 5 && !examples.some((e) => e.from === tag)) {
        examples.push({ from: tag, to: hit.to });
        examplesByRule.set(hit.rule.index, examples);
      }

      // The same tag produced twice means two sources converged — often exactly the point
      // ("readinglist" and "reading list" both to "reading-list"), but always worth showing.
      if (produced.has(hit.to)) collide(hit.rule.index, hit.to);
      produced.set(hit.to, hit.rule.index);
    }

    // Renames that land on a tag the record already had and keeps. Checked after the loop
    // because the surviving tag may come later in the list than the rename onto it.
    for (const [tag, index] of produced) {
      if (untouched.has(tag)) collide(index, tag);
    }

    if (touched.size > 0) affected += 1;
    for (const index of touched) {
      affectedByRule.set(index, (affectedByRule.get(index) ?? 0) + 1);
    }
  }

  const rows: BatchRenameRow[] = rules.map((rule, index) => {
    const count = affectedByRule.get(index) ?? 0;
    const problem = problems[index] ?? null;
    return {
      index,
      source: normalizeTag(rule.from),
      target: normalizeTag(rule.to),
      affected: count,
      examples: examplesByRule.get(index) ?? [],
      collisions: [...(collisionsByRule.get(index) ?? [])].sort(),
      // A complete row matching nothing is worth saying so: it is almost always a typo in a
      // tag name, and the alternative is a silent no-op the user reads as success.
      problem: problem ?? (count === 0 ? "no-match" : null),
    };
  });

  return {
    rows,
    affected,
    applicable: rows.filter((r) => r.problem === null).length,
  };
}

/**
 * Apply a table of renames in one pass.
 *
 * Shares `compileRules` and `rewriteTag` with the plan, which is the point: a preview computed
 * by different code from the operation it previews is a preview of nothing.
 */
export function applyBatchRename(
  bookmarks: Bookmark[],
  rules: RenameRule[],
  now: string,
): Bookmark[] {
  const { compiled } = compileRules(rules);
  if (compiled.length === 0) return bookmarks;

  let changed = false;
  const next = bookmarks.map((b) => {
    if (b.deletedAt) return b;
    if (!b.tags.some((t) => rewriteTag(t, compiled))) return b;

    changed = true;
    // normalizeTags sorts and dedupes, so converging renames merge here rather than leaving
    // the same tag on one record twice.
    const tags = normalizeTags(b.tags.map((t) => rewriteTag(t, compiled)?.to ?? t));
    return { ...b, tags, updatedAt: now };
  });

  // Identity return when nothing matched, so callers can skip the write entirely.
  return changed ? next : bookmarks;
}
