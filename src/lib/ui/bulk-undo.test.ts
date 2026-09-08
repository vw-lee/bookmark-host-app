import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppStore } from "../store.svelte";
import { encodeBase64 } from "../api/base64";
import { serialize } from "../schema/serialize";
import { emptyFile } from "../schema/types";

/**
 * Undo (7j), selection and bulk edits (7k), and the three scopes (7i).
 *
 * These three arrived together because they share a spine: every bulk operation snapshots the
 * records first, so one Undo covers an action that touched 200 of them, and the trash is just
 * a fourth thing the same machinery can put back.
 */

const EMPTY = serialize(emptyFile("2026-08-20T08:00:00.000Z"));

async function connected(): Promise<AppStore> {
  let i = 0;
  const bodies = [
    { name: "r" },
    { content: encodeBase64(EMPTY), encoding: "base64", sha: "s", size: EMPTY.length },
    { content: { sha: "next" } },
  ];
  const f = vi.fn(
    async () =>
      new Response(JSON.stringify(bodies[Math.min(i++, bodies.length - 1)]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;
  const store = new AppStore();
  await store.connect({ token: "t", owner: "o", repo: "r", path: "p.json" }, null, f);
  return store;
}

let store: AppStore;
const idOf = (title: string) => store.file.bookmarks.find((b) => b.title === title)!.id;
const titles = () => store.visible.map((b) => b.title).sort();

beforeEach(async () => {
  store = await connected();
  store.addBookmark({ url: "https://a.example/1", title: "A", tags: ["dev/rust"] });
  store.addBookmark({ url: "https://b.example/2", title: "B", tags: ["dev/go"] });
  store.addBookmark({ url: "https://c.example/3", title: "C" });
});

describe("undo (task 7j)", () => {
  it("offers to undo a delete, and puts the record back", () => {
    store.deleteBookmark(idOf("A"));

    expect(store.undoable?.label).toBe("Deleted A");
    expect(titles()).toEqual(["B", "C"]);

    store.undo();
    expect(titles()).toEqual(["A", "B", "C"]);
    expect(store.undoable).toBeNull();
  });

  it("restores exactly the previous records, not an approximation of them", () => {
    // A snapshot rather than an inverse operation, so an action that touched more than it
    // meant to is still fully reversible.
    const [a, b] = [idOf("A"), idOf("B")];
    store.updateBookmark(a, { title: "A edited" });
    const before = store.file.bookmarks;

    store.deleteMany([a, b]);
    store.undo();

    expect(store.file.bookmarks).toEqual(before);
  });

  it("keeps only the most recent action undoable", () => {
    store.deleteBookmark(idOf("A"));
    store.deleteBookmark(idOf("B"));

    expect(store.undoable?.label).toBe("Deleted B");
    store.undo();
    // Undoing the second delete does not resurrect the first.
    expect(titles()).toEqual(["B", "C"]);
  });

  it("expires the offer, so a stale toast cannot revert work done since", () => {
    vi.useFakeTimers();
    try {
      const fresh = new AppStore();
      fresh.addBookmark({ url: "https://a.example/1", title: "A" });
      fresh.deleteBookmark(fresh.file.bookmarks[0]!.id);
      expect(fresh.undoable).not.toBeNull();

      vi.advanceTimersByTime(60_000);
      expect(fresh.undoable).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("dismisses without changing anything", () => {
    store.deleteBookmark(idOf("A"));
    store.dismissUndo();

    expect(store.undoable).toBeNull();
    expect(titles()).toEqual(["B", "C"]);
  });
});

describe("scopes (task 7i)", () => {
  it("separates active, archived and trash", () => {
    store.updateBookmark(idOf("B"), { archived: true });
    store.deleteBookmark(idOf("C"));

    expect(store.scopeCounts).toEqual({ active: 1, archived: 1, trash: 1 });

    expect(titles()).toEqual(["A"]);
    store.scope = "archived";
    expect(titles()).toEqual(["B"]);
    store.scope = "trash";
    expect(titles()).toEqual(["C"]);
  });

  it("restores from the trash by clearing the tombstone", () => {
    const id = idOf("C");
    store.deleteBookmark(id);
    store.scope = "trash";

    store.restoreMany([id]);
    expect(store.visible).toHaveLength(0);

    store.scope = "active";
    expect(titles()).toEqual(["A", "B", "C"]);
    // updatedAt must move, or a device that still thinks it is deleted wins the merge (§3.2).
    const restored = store.file.bookmarks.find((b) => b.id === id)!;
    expect(restored.deletedAt).toBeNull();
    expect(restored.updatedAt >= restored.createdAt).toBe(true);
  });

  it("counts tags within the current scope only", () => {
    store.updateBookmark(idOf("A"), { archived: true });
    expect(store.tagCounts.get("dev")!.total).toBe(1);
    store.scope = "archived";
    expect(store.tagCounts.get("dev")!.total).toBe(1);
    expect(store.tagCounts.get("dev/go")).toBeUndefined();
  });
});

describe("selection and bulk edits (task 7k)", () => {
  it("adds tags to many records under one undo entry", () => {
    store.addTags([idOf("A"), idOf("B")], ["reading"]);

    expect(store.undoable?.label).toBe("Tagged 2 bookmarks");
    expect(store.file.bookmarks.find((b) => b.title === "A")!.tags).toContain("reading");
    // Existing tags survive — an import must never silently drop categorisation.
    expect(store.file.bookmarks.find((b) => b.title === "A")!.tags).toContain("dev/rust");

    store.undo();
    expect(store.file.bookmarks.find((b) => b.title === "A")!.tags).toEqual(["dev/rust"]);
  });

  it("removes a tag and its descendants", () => {
    store.addTags([idOf("C")], ["dev/rust/async"]);
    store.removeTags([idOf("A"), idOf("C")], ["dev"]);

    expect(store.file.bookmarks.find((b) => b.title === "A")!.tags).toEqual([]);
    expect(store.file.bookmarks.find((b) => b.title === "C")!.tags).toEqual([]);
    // Untouched, because it was not in the id list.
    expect(store.file.bookmarks.find((b) => b.title === "B")!.tags).toEqual(["dev/go"]);
  });

  it("selects every match, not just the visible page", () => {
    // The reason the feature exists: retagging an import must not mean six rounds of fifty.
    store.pageSize = 2;
    expect(store.pageItems).toHaveLength(2);

    store.selectAllMatching();
    expect(store.selection).toHaveLength(3);
  });

  it("never acts on records the filter has since hidden", () => {
    store.selectAllMatching();
    expect(store.selectedVisible).toHaveLength(3);

    store.query = "tag:dev/rust";
    // B and C are still selected, but they are no longer on screen — acting on them would be
    // an edit the user cannot see happening.
    expect(store.selection).toHaveLength(3);
    expect(store.selectedVisible.map((b) => b.title)).toEqual(["A"]);
  });

  it("toggles a whole page on and back off", () => {
    store.pageSize = 2;
    store.selectPage();
    expect(store.selection).toHaveLength(2);

    store.selectPage();
    expect(store.selection).toHaveLength(0);
  });

  it("clears the selection after a bulk delete, so nothing invisible stays selected", () => {
    store.selectAllMatching();
    store.deleteMany(store.selection);

    expect(store.selection).toEqual([]);
    expect(store.visible).toHaveLength(0);
    expect(store.undoable?.label).toBe("Deleted 3 bookmarks");

    store.undo();
    expect(titles()).toEqual(["A", "B", "C"]);
  });

  it("ignores an empty selection rather than recording a no-op undo", () => {
    store.addTags([], ["x"]);
    store.deleteMany([]);
    expect(store.undoable).toBeNull();
  });
});

describe("search operators reach the store (task 7h)", () => {
  it("filters with tag:, site: and is:", () => {
    store.query = "tag:dev";
    expect(titles()).toEqual(["A", "B"]);

    store.query = "site:b.example";
    expect(titles()).toEqual(["B"]);

    store.query = "is:untagged";
    expect(titles()).toEqual(["C"]);

    store.query = "-tag:dev";
    expect(titles()).toEqual(["C"]);
  });

  it("ANDs a tag operator with the sidebar tag filter", () => {
    store.selectedTag = "dev";
    store.query = "tag:dev/go";
    expect(titles()).toEqual(["B"]);
  });
});

describe("batch tag rename reaches the store (task 7p)", () => {
  it("applies every rule as one change, and one undo entry", () => {
    const affected = store.renameTagsBatch([
      { from: "dev/rust", to: "languages/rust" },
      { from: "dev/go", to: "languages/go" },
    ]);

    expect(affected).toBe(2);
    expect(store.file.bookmarks.find((b) => b.title === "A")!.tags).toEqual(["languages/rust"]);
    expect(store.file.bookmarks.find((b) => b.title === "B")!.tags).toEqual(["languages/go"]);

    // One entry, not two: the batch is a single action the user took.
    expect(store.undoable?.label).toContain("2 tags");
    store.undo();
    expect(store.file.bookmarks.find((b) => b.title === "A")!.tags).toEqual(["dev/rust"]);
    expect(store.file.bookmarks.find((b) => b.title === "B")!.tags).toEqual(["dev/go"]);
  });

  it("takes no undo entry when nothing matched", () => {
    // An undo offer for a change that never happened would send the user back past the last
    // thing they actually did.
    expect(store.renameTagsBatch([{ from: "nosuchtag", to: "whatever" }])).toBe(0);
    expect(store.undoable).toBeNull();
  });

  it("clears a sidebar filter whose tag the batch moved", () => {
    // A filter on a tag that no longer exists shows an empty list with no explanation.
    store.selectedTag = "dev/rust";
    store.renameTagsBatch([{ from: "dev", to: "engineering" }]);
    expect(store.selectedTag).toBeNull();
  });

  it("leaves an unrelated filter alone", () => {
    store.addBookmark({ url: "https://d.example/4", title: "D", tags: ["reading"] });
    store.selectedTag = "reading";
    store.renameTagsBatch([{ from: "dev", to: "engineering" }]);
    expect(store.selectedTag).toBe("reading");
  });
});
