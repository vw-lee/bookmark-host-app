import { describe, it, expect } from "vitest";
import { filterTags } from "./tagFilter";

/**
 * Tag sidebar filtering (task 7q, D26).
 *
 * The two rules under test: a match is a fuzzy hit on the full path, and ancestors of a match
 * stay visible as context. The third assertion that matters is about order — results stay
 * alphabetical whatever the scores say, because a tree whose children drift away from their
 * parents is no longer a tree.
 */

const TAGS = [
  "dev",
  "dev/rust",
  "dev/rust/async",
  "dev/web",
  "development",
  "reading-list",
  "recipes",
].sort();

function visible(query: string): string[] {
  return filterTags(TAGS, query).nodes.map((n) => n.tag);
}

describe("filterTags (7q)", () => {
  it("returns everything, all as matches, for an empty query", () => {
    const result = filterTags(TAGS, "");
    expect(result.nodes.map((n) => n.tag)).toEqual(TAGS);
    expect(result.nodes.every((n) => n.match)).toBe(true);
    expect(result.best).toBeNull();
  });

  it("treats whitespace as an empty query", () => {
    expect(filterTags(TAGS, "   ").best).toBeNull();
    expect(visible("   ")).toEqual(TAGS);
  });

  it("matches on the full path, so a parent's query keeps its children", () => {
    expect(visible("dev")).toEqual(["dev", "dev/rust", "dev/rust/async", "dev/web", "development"]);
  });

  it("keeps ancestors of a match as context, marked as such", () => {
    const result = filterTags(TAGS, "async");
    expect(result.nodes).toEqual([
      { tag: "dev", match: false },
      { tag: "dev/rust", match: false },
      { tag: "dev/rust/async", match: true },
    ]);
  });

  it("does not demote a node to context when it matched on its own", () => {
    // "rust" hits dev/rust directly and dev/rust/async directly; dev is context only.
    const result = filterTags(TAGS, "rust");
    expect(result.nodes).toEqual([
      { tag: "dev", match: false },
      { tag: "dev/rust", match: true },
      { tag: "dev/rust/async", match: true },
    ]);
  });

  it("matches a fuzzy subsequence the way the palette does", () => {
    // d-r-a across the word boundaries of dev/rust/async.
    expect(visible("dra")).toContain("dev/rust/async");
    expect(visible("dra")).not.toContain("recipes");
  });

  it("is case-insensitive", () => {
    expect(visible("RUST")).toContain("dev/rust");
  });

  it("stays alphabetical regardless of score", () => {
    // "re" is a prefix of both; recipes would tie or beat reading-list on score, but order is
    // the tree's, not the ranking's.
    expect(visible("re")).toEqual(["reading-list", "recipes"]);
  });

  it("names the strongest match as best, for Enter", () => {
    // An exact prefix beats a mid-word hit: "dev" is best over "development".
    expect(filterTags(TAGS, "dev").best).toBe("dev");
    // Only one candidate contains "cip".
    expect(filterTags(TAGS, "cip").best).toBe("recipes");
  });

  it("breaks a score tie towards the alphabetically earlier tag", () => {
    // Both are a prefix match scoring 1000; the first in order wins so Enter is predictable.
    expect(filterTags(TAGS, "re").best).toBe("reading-list");
  });

  it("returns nothing and no best when no tag matches", () => {
    const result = filterTags(TAGS, "zzz");
    expect(result.nodes).toEqual([]);
    expect(result.best).toBeNull();
  });
});
