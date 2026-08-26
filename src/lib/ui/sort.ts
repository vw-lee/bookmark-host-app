/**
 * Ordering for the bookmark list (task 7g).
 *
 * Extracted from the store so the comparator is testable without building a store, and so the
 * table's sortable headers and the default order cannot drift apart — there is one comparator
 * and the table simply chooses its arguments.
 */
import type { Bookmark } from "../schema/types";

export type SortKey = "added" | "title" | "host" | "updated";
export type SortDir = "asc" | "desc";

export const SORT_LABELS: Record<SortKey, string> = {
  added: "Added",
  title: "Title",
  host: "Site",
  updated: "Updated",
};

/** Display host for sorting and for the table's Site column. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

function time(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Compare on one key, ignoring pinning and direction — both are applied by the caller.
 *
 * Titles use localeCompare so accented titles sort where a reader expects rather than after Z,
 * and `numeric` so "Chapter 2" precedes "Chapter 10".
 */
function compareKey(a: Bookmark, b: Bookmark, key: SortKey): number {
  switch (key) {
    case "title":
      return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
    case "host":
      return hostOf(a.url).localeCompare(hostOf(b.url), undefined, { sensitivity: "base" });
    case "updated":
      return time(a.updatedAt) - time(b.updatedAt);
    case "added":
    default:
      // ULIDs sort by creation time, so the id is the key — no date parsing needed (§3.1).
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
}

/**
 * The comparator the list actually uses.
 *
 * Pinned records float to the top in **every** mode and under every sort. A pin is the user
 * saying "keep this where I can see it", and honouring that only in the default order would
 * make pinning feel like it stopped working the moment a column header was clicked.
 */
export function comparator(key: SortKey, dir: SortDir): (a: Bookmark, b: Bookmark) => number {
  const sign = dir === "asc" ? 1 : -1;
  return (a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const primary = compareKey(a, b, key) * sign;
    if (primary !== 0) return primary;
    // Ties must break deterministically or pagination shuffles items between renders.
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  };
}
