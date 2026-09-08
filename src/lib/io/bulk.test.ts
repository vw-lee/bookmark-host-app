import { describe, it, expect } from "vitest";
import {
  findDuplicates,
  applyDedupe,
  planRename,
  applyRename,
  planDeleteTag,
  applyDeleteTag,
  planBatchRename,
  applyBatchRename,
} from "./bulk";
import type { Bookmark } from "../schema/types";

const NOW = "2026-08-24T08:00:00.000Z";

function b(id: string, over: Partial<Bookmark> = {}): Bookmark {
  return {
    id,
    url: "https://example.com/p",
    urlKey: "example.com/p",
    title: id,
    description: "",
    notes: "",
    tags: [],
    favicon: null,
    pinned: false,
    archived: false,
    createdAt: "2026-08-20T08:00:00.000Z",
    updatedAt: "2026-08-20T08:00:00.000Z",
    deletedAt: null,
    enrichedAt: null,
    ...over,
  };
}

describe("findDuplicates (4e)", () => {
  it("groups live records sharing a urlKey", () => {
    const groups = findDuplicates([
      b("01A", { tags: ["one"] }),
      b("01B", { tags: ["two"] }),
      b("01C", { urlKey: "other.com", tags: ["x"] }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.keep.id).toBe("01A");
    expect(groups[0]!.merge.map((m) => m.id)).toEqual(["01B"]);
    expect(groups[0]!.mergedTags).toEqual(["one", "two"]);
  });

  it("keeps the OLDEST record, preserving the original creation date", () => {
    const groups = findDuplicates([b("01Z"), b("01A"), b("01M")]);
    expect(groups[0]!.keep.id).toBe("01A");
  });

  it("ignores tombstones and records with no urlKey", () => {
    expect(findDuplicates([b("01A"), b("01B", { deletedAt: NOW })])).toEqual([]);
    expect(findDuplicates([b("01A", { urlKey: "" }), b("01B", { urlKey: "" })])).toEqual([]);
  });

  it("finds nothing in a clean collection", () => {
    expect(findDuplicates([b("01A"), b("01B", { urlKey: "other.com" })])).toEqual([]);
  });
});

describe("applyDedupe (4e)", () => {
  it("merges tags into the survivor and tombstones the rest", () => {
    const input = [b("01A", { tags: ["one"] }), b("01B", { tags: ["two"] })];
    const out = applyDedupe(input, findDuplicates(input), NOW);

    expect(out[0]!.tags).toEqual(["one", "two"]);
    expect(out[0]!.deletedAt).toBeNull();
    // The loser is tombstoned, not removed — the deletion has to survive a merge (§3.1).
    expect(out[1]!.deletedAt).toBe(NOW);
  });

  it("keeps the longest description rather than the survivor's empty one", () => {
    const input = [b("01A", { description: "" }), b("01B", { description: "a real summary" })];
    const out = applyDedupe(input, findDuplicates(input), NOW);
    expect(out[0]!.description).toBe("a real summary");
  });

  it("preserves a pin from any copy in the group", () => {
    const input = [b("01A"), b("01B", { pinned: true })];
    expect(applyDedupe(input, findDuplicates(input), NOW)[0]!.pinned).toBe(true);
  });

  it("leaves unrelated records untouched", () => {
    const other = b("01C", { urlKey: "other.com" });
    const input = [b("01A"), b("01B"), other];
    const out = applyDedupe(input, findDuplicates(input), NOW);
    expect(out[2]).toEqual(other);
  });
});

describe("planRename / applyRename (4f)", () => {
  const collection = [
    b("01A", { tags: ["dev"] }),
    b("01B", { tags: ["dev/rust"] }),
    b("01C", { tags: ["dev/rust/async", "other"] }),
    b("01D", { tags: ["development"] }),
  ];

  it("carries the whole subtree, not just the exact tag", () => {
    // Renaming dev without carrying dev/rust would orphan the subtree.
    const out = applyRename(collection, "dev", "engineering", NOW);
    expect(out[0]!.tags).toEqual(["engineering"]);
    expect(out[1]!.tags).toEqual(["engineering/rust"]);
    expect(out[2]!.tags).toEqual(["engineering/rust/async", "other"]);
  });

  it("does not touch a sibling that merely shares a prefix", () => {
    const out = applyRename(collection, "dev", "engineering", NOW);
    expect(out[3]!.tags).toEqual(["development"]);
  });

  it("counts affected records and shows examples before applying", () => {
    const plan = planRename(collection, "dev", "engineering");
    expect(plan.affected).toBe(3);
    expect(plan.examples[0]).toEqual({ from: "dev", to: "engineering" });
  });

  it("normalises the target, so a messy rename still lands canonically", () => {
    const out = applyRename(collection, "dev", "  Engineering / Backend  ", NOW);
    expect(out[1]!.tags).toEqual(["engineering/backend/rust"]);
  });

  it("merges when renaming onto an existing tag", () => {
    const input = [b("01A", { tags: ["dev", "engineering"] })];
    const plan = planRename(input, "dev", "engineering");
    expect(plan.collisions).toEqual(["engineering"]);
    // The result must not contain a duplicate.
    expect(applyRename(input, "dev", "engineering", NOW)[0]!.tags).toEqual(["engineering"]);
  });

  it("refuses a no-op or an empty target", () => {
    expect(planRename(collection, "dev", "dev").affected).toBe(0);
    expect(planRename(collection, "dev", "   ").affected).toBe(0);
    expect(applyRename(collection, "dev", "", NOW)).toBe(collection);
  });

  it("bumps updatedAt only on records it changed", () => {
    const out = applyRename(collection, "dev", "engineering", NOW);
    expect(out[0]!.updatedAt).toBe(NOW);
    expect(out[3]!.updatedAt).toBe("2026-08-20T08:00:00.000Z");
  });
});

describe("planDeleteTag / applyDeleteTag (4f)", () => {
  const collection = [
    b("01A", { tags: ["dev", "keep"] }),
    b("01B", { tags: ["dev/rust"] }),
    b("01C", { tags: ["development"] }),
  ];

  it("removes the tag and its descendants, keeping other tags", () => {
    const out = applyDeleteTag(collection, "dev", NOW);
    expect(out[0]!.tags).toEqual(["keep"]);
    expect(out[1]!.tags).toEqual([]);
  });

  it("never deletes the bookmark itself", () => {
    const out = applyDeleteTag(collection, "dev", NOW);
    expect(out.every((x) => x.deletedAt === null)).toBe(true);
    expect(out).toHaveLength(3);
  });

  it("leaves a prefix-sharing sibling alone", () => {
    expect(applyDeleteTag(collection, "dev", NOW)[2]!.tags).toEqual(["development"]);
  });

  it("reports what it would affect", () => {
    expect(planDeleteTag(collection, "dev").affected).toBe(2);
  });
});

describe("planBatchRename / applyBatchRename (7p)", () => {
  const collection = [
    b("01A", { tags: ["readinglist", "dev"] }),
    b("01B", { tags: ["reading list"] }),
    b("01C", { tags: ["dev/rust", "keep"] }),
    b("01D", { tags: ["development"] }),
    b("01E", { tags: ["gone"], deletedAt: NOW }),
  ];

  it("applies several renames in one pass", () => {
    const out = applyBatchRename(
      collection,
      [
        { from: "readinglist", to: "reading-list" },
        { from: "dev", to: "engineering" },
      ],
      NOW,
    );
    expect(out[0]!.tags).toEqual(["engineering", "reading-list"]);
    expect(out[2]!.tags).toEqual(["engineering/rust", "keep"]);
  });

  it("counts distinct bookmarks, not the sum of the rows", () => {
    // 01A carries both source tags. Summing the per-row counts would report 3.
    const plan = planBatchRename(collection, [
      { from: "readinglist", to: "reading-list" },
      { from: "dev", to: "engineering" },
    ]);
    expect(plan.rows[0]!.affected).toBe(1);
    expect(plan.rows[1]!.affected).toBe(2);
    expect(plan.affected).toBe(2);
  });

  /**
   * The rule the whole design rests on. Sequential application would turn `dev` into `eng`
   * via `engineering`, which no preview could honestly show — the result would depend on the
   * order of two rows the user thinks of as independent.
   */
  it("never chains one rename into the next", () => {
    const out = applyBatchRename(
      collection,
      [
        { from: "dev", to: "engineering" },
        { from: "engineering", to: "eng" },
      ],
      NOW,
    );
    expect(out[0]!.tags).toContain("engineering");
    expect(out[0]!.tags).not.toContain("eng");
  });

  it("is indifferent to row order", () => {
    const rules = [
      { from: "dev", to: "engineering" },
      { from: "readinglist", to: "reading-list" },
    ];
    const forward = applyBatchRename(collection, rules, NOW);
    const reversed = applyBatchRename(collection, [...rules].reverse(), NOW);
    expect(forward.map((x) => x.tags)).toEqual(reversed.map((x) => x.tags));
  });

  it("lets the most specific source win over a parent rule", () => {
    const out = applyBatchRename(
      collection,
      [
        { from: "dev", to: "engineering" },
        { from: "dev/rust", to: "languages/rust" },
      ],
      NOW,
    );
    // 01C's dev/rust takes the specific rule; 01A's bare dev takes the general one.
    expect(out[2]!.tags).toEqual(["keep", "languages/rust"]);
    expect(out[0]!.tags).toContain("engineering");
  });

  it("carries whole subtrees", () => {
    const out = applyBatchRename(collection, [{ from: "dev", to: "engineering" }], NOW);
    expect(out[2]!.tags).toContain("engineering/rust");
  });

  it("leaves a prefix-sharing sibling alone", () => {
    const out = applyBatchRename(collection, [{ from: "dev", to: "engineering" }], NOW);
    expect(out[3]!.tags).toEqual(["development"]);
  });

  it("never touches a tombstoned record", () => {
    const out = applyBatchRename(collection, [{ from: "gone", to: "here" }], NOW);
    expect(out[4]!.tags).toEqual(["gone"]);
    expect(out).toBe(collection);
  });

  it("merges converging renames into one tag, and says so first", () => {
    const rules = [
      { from: "readinglist", to: "reading-list" },
      { from: "reading list", to: "reading-list" },
    ];
    const plan = planBatchRename(collection, rules);
    expect(plan.applicable).toBe(2);

    const out = applyBatchRename(collection, rules, NOW);
    expect(out[0]!.tags).toContain("reading-list");
    expect(out[1]!.tags).toEqual(["reading-list"]);
  });

  it("flags a rename that lands on a tag the record already has", () => {
    const one = [b("01F", { tags: ["dev", "engineering"] })];
    const plan = planBatchRename(one, [{ from: "dev", to: "engineering" }]);
    expect(plan.rows[0]!.collisions).toEqual(["engineering"]);

    const out = applyBatchRename(one, [{ from: "dev", to: "engineering" }], NOW);
    expect(out[0]!.tags).toEqual(["engineering"]);
  });

  it("explains every row that will do nothing", () => {
    const plan = planBatchRename(collection, [
      { from: "", to: "" },
      { from: "Dev", to: "dev" },
      { from: "dev", to: "engineering" },
      { from: "dev", to: "something-else" },
      { from: "nosuchtag", to: "whatever" },
    ]);
    expect(plan.rows.map((r) => r.problem)).toEqual([
      "empty",
      // normalizeTag only lowercases, so both sides land on "dev": already satisfied.
      "same",
      null,
      "duplicate",
      "no-match",
    ]);
    expect(plan.applicable).toBe(1);
  });

  it("ignores a duplicate source rather than letting it win", () => {
    const out = applyBatchRename(
      collection,
      [
        { from: "dev", to: "engineering" },
        { from: "dev", to: "something-else" },
      ],
      NOW,
    );
    expect(out[0]!.tags).toContain("engineering");
    expect(out[0]!.tags).not.toContain("something-else");
  });

  it("returns the same array when nothing matches, so no write is queued", () => {
    expect(applyBatchRename(collection, [{ from: "nope", to: "nah" }], NOW)).toBe(collection);
    expect(applyBatchRename(collection, [], NOW)).toBe(collection);
  });

  it("previews the tag-level changes it will make", () => {
    const plan = planBatchRename(collection, [{ from: "dev", to: "engineering" }]);
    expect(plan.rows[0]!.examples).toContainEqual({ from: "dev", to: "engineering" });
    expect(plan.rows[0]!.examples).toContainEqual({ from: "dev/rust", to: "engineering/rust" });
  });

  it("stamps updatedAt only on the records it changed", () => {
    const out = applyBatchRename(collection, [{ from: "dev", to: "engineering" }], NOW);
    expect(out[0]!.updatedAt).toBe(NOW);
    expect(out[3]!.updatedAt).not.toBe(NOW);
  });
});
