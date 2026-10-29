/**
 * Tag sidebar filtering (task 7q, D26).
 *
 * The sidebar lists every tag node alphabetically, which is fine at twenty tags and useless at
 * three hundred — the scale a browser import lands you at in one go. The palette (7a) could
 * already fuzzy-find a tag, but it is a modal: you lose sight of the tree, and the tree is the
 * thing that tells you `dev/rust` exists before you type `rust` a second way.
 *
 * So the filter narrows the tree in place. Two rules decide what stays visible:
 *
 *   1. A node is a MATCH when the query fuzzy-matches its full path, using the same subsequence
 *      scoring as the palette so "dra" finds `dev/rust/async` the way it would in Ctrl-K. One
 *      ranking across the app, not two the user has to learn apart. Matching the full path also
 *      means a parent's children survive its query for free — `dev/rust` contains `dev`.
 *   2. Every ancestor of a match is kept as CONTEXT, so indentation keeps meaning something. A
 *      context node did not match on its own merits and is rendered dimmed to say so.
 *
 * Order stays alphabetical rather than by score. Fuzzy ranking in a tree would shuffle children
 * away from their parents, and the tree shape is the whole reason the filter lives here rather
 * than in the palette. The score is used once: to name the BEST match, which is what Enter
 * selects. Pure functions, so all of this is testable without a DOM.
 */

import { score } from "./palette";

export interface FilteredNode {
  tag: string;
  /** True when the query matched this node itself; false when it is here only as an ancestor. */
  match: boolean;
}

export interface TagFilterResult {
  /** Visible nodes, in the alphabetical order the tree already uses. */
  nodes: FilteredNode[];
  /** The highest-scoring match — what Enter should select — or null when nothing matched. */
  best: string | null;
}

/** Every proper ancestor of a `/`-delimited tag: `a/b/c` gives `a` and `a/b`. */
function ancestorsOf(tag: string): string[] {
  const parts = tag.split("/");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

/**
 * Narrow `tags` (already sorted) to those matching `query`, plus their ancestors.
 *
 * An empty or whitespace query is not a filter: every node comes back as a match with no best,
 * so Enter on an empty box does nothing rather than selecting the alphabetically first tag.
 */
export function filterTags(tags: readonly string[], query: string): TagFilterResult {
  const needle = query.trim();
  if (!needle) {
    return { nodes: tags.map((tag) => ({ tag, match: true })), best: null };
  }

  const matched = new Set<string>();
  let best: string | null = null;
  let bestScore = -1;

  for (const tag of tags) {
    const s = score(tag, needle);
    if (s < 0) continue;
    matched.add(tag);
    // Strictly greater, so a tie goes to the earlier — alphabetically first — tag. Predictable
    // beats clever when the result is what Enter is about to do.
    if (s > bestScore) {
      bestScore = s;
      best = tag;
    }
  }

  // Ancestors are added after the match pass so that a node which both matched and is someone
  // else's ancestor keeps its `match: true` — context is only for nodes that earned nothing.
  const context = new Set<string>();
  for (const tag of matched) {
    for (const ancestor of ancestorsOf(tag)) {
      if (!matched.has(ancestor)) context.add(ancestor);
    }
  }

  const nodes: FilteredNode[] = [];
  for (const tag of tags) {
    if (matched.has(tag)) nodes.push({ tag, match: true });
    else if (context.has(tag)) nodes.push({ tag, match: false });
  }

  return { nodes, best };
}
