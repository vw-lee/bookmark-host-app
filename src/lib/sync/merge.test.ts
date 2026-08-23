import { describe, it, expect } from "vitest";
import { merge, liveBookmarks, TOMBSTONE_RETENTION_DAYS } from "./merge";
import { serialize } from "../schema/serialize";
import type { Bookmark, BookmarkFile } from "../schema/types";

const T0 = "2026-08-20T08:00:00.000Z";
const T1 = "2026-08-21T08:00:00.000Z";
const T2 = "2026-08-22T08:00:00.000Z";
const NOW = Date.parse("2026-08-23T08:00:00.000Z");

function bookmark(id: string, over: Partial<Bookmark> = {}): Bookmark {
  return {
    id,
    url: `https://example.com/${id}`,
    urlKey: `example.com/${id}`,
    title: id,
    description: "",
    notes: "",
    tags: [],
    favicon: null,
    pinned: false,
    archived: false,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    enrichedAt: null,
    ...over,
  };
}

function file(bookmarks: Bookmark[], over: Partial<BookmarkFile> = {}): BookmarkFile {
  return { schemaVersion: 2, updatedAt: T0, tagMeta: {}, bookmarks, ...over };
}

describe("merge — union (rule 1)", () => {
  it("keeps records unique to either side", () => {
    const out = merge(file([bookmark("a")]), file([bookmark("b")]), { now: NOW });
    expect(out.bookmarks.map((b) => b.id).sort()).toEqual(["a", "b"]);
  });

  it("handles both sides empty", () => {
    expect(merge(file([]), file([]), { now: NOW }).bookmarks).toEqual([]);
  });
});

describe("merge — last write wins (rule 2)", () => {
  it("keeps the newer version of a record present on both sides", () => {
    const older = bookmark("a", { title: "old", updatedAt: T0 });
    const newer = bookmark("a", { title: "new", updatedAt: T1 });

    expect(merge(file([older]), file([newer]), { now: NOW }).bookmarks[0]!.title).toBe("new");
    // Symmetric: argument order must not change the outcome.
    expect(merge(file([newer]), file([older]), { now: NOW }).bookmarks[0]!.title).toBe("new");
  });
});

describe("merge — delete beats edit on a tie (rule 3)", () => {
  it("resolves a same-timestamp delete/edit race to deleted", () => {
    const edited = bookmark("a", { title: "edited", updatedAt: T1 });
    const deleted = bookmark("a", { updatedAt: T1, deletedAt: T1 });

    for (const out of [
      merge(file([edited]), file([deleted]), { now: NOW }),
      merge(file([deleted]), file([edited]), { now: NOW }),
    ]) {
      expect(out.bookmarks[0]!.deletedAt).toBe(T1);
    }
  });

  it("still lets a LATER edit undelete", () => {
    // Deleting then re-adding the same bookmark must work.
    const deleted = bookmark("a", { updatedAt: T1, deletedAt: T1 });
    const readded = bookmark("a", { title: "back", updatedAt: T2, deletedAt: null });
    const out = merge(file([deleted]), file([readded]), { now: NOW });
    expect(out.bookmarks[0]!.deletedAt).toBeNull();
    expect(out.bookmarks[0]!.title).toBe("back");
  });

  it("does not resurrect a deletion the other side never saw", () => {
    // The classic sync bug this whole tombstone design exists to prevent: device A deletes,
    // device B still holds the original, merge must not bring it back.
    const stillPresent = bookmark("a", { updatedAt: T0 });
    const deleted = bookmark("a", { updatedAt: T1, deletedAt: T1 });
    const out = merge(file([stillPresent]), file([deleted]), { now: NOW });
    expect(liveBookmarks(out)).toHaveLength(0);
  });
});

describe("merge — tagMeta (rule 4)", () => {
  it("unions keys and lets remote win a collision", () => {
    const local = file([], { tagMeta: { dev: { color: "#local" }, only: { order: 1 } } });
    const remote = file([], { tagMeta: { dev: { color: "#remote" } } });
    const out = merge(local, remote, { now: NOW });
    expect(out.tagMeta.dev!.color).toBe("#remote");
    expect(out.tagMeta.only!.order).toBe(1);
  });
});

describe("merge — tombstone pruning (rule 5)", () => {
  it("drops tombstones past the retention window", () => {
    const old = new Date(NOW - (TOMBSTONE_RETENTION_DAYS + 1) * 86_400_000).toISOString();
    const out = merge(file([bookmark("a", { updatedAt: old, deletedAt: old })]), file([]), {
      now: NOW,
    });
    expect(out.bookmarks).toHaveLength(0);
  });

  it("keeps tombstones inside the window", () => {
    const recent = new Date(NOW - (TOMBSTONE_RETENTION_DAYS - 1) * 86_400_000).toISOString();
    const out = merge(file([bookmark("a", { updatedAt: recent, deletedAt: recent })]), file([]), {
      now: NOW,
    });
    expect(out.bookmarks).toHaveLength(1);
    expect(liveBookmarks(out)).toHaveLength(0);
  });

  it("never prunes a live record however old", () => {
    const ancient = "2019-01-01T00:00:00.000Z";
    const out = merge(file([bookmark("a", { updatedAt: ancient })]), file([]), { now: NOW });
    expect(out.bookmarks).toHaveLength(1);
  });
});

describe("merge — document timestamp (rule 6)", () => {
  it("reflects the newest record, not the wall clock", () => {
    const out = merge(file([bookmark("a", { updatedAt: T2 })]), file([]), { now: NOW });
    expect(out.updatedAt).toBe(T2);
  });

  it("is idempotent — merging a document with itself changes nothing", () => {
    // If this failed, every sync would produce a commit that differs only by timestamp,
    // and every device would conflict with every other one forever.
    const f = file([bookmark("a", { updatedAt: T1 }), bookmark("b", { updatedAt: T2 })], {
      updatedAt: T2,
    });
    const once = merge(f, f, { now: NOW });
    const twice = merge(once, once, { now: NOW });
    expect(serialize(once)).toBe(serialize(f));
    expect(serialize(twice)).toBe(serialize(once));
  });
});

describe("merge — robustness", () => {
  it("treats an unparseable date as oldest instead of throwing", () => {
    const corrupt = bookmark("a", { title: "corrupt", updatedAt: "not-a-date" });
    const good = bookmark("a", { title: "good", updatedAt: T0 });
    const out = merge(file([corrupt]), file([good]), { now: NOW });
    expect(out.bookmarks[0]!.title).toBe("good");
  });

  it("produces byte-identical output regardless of argument order", () => {
    const a = file([bookmark("a", { updatedAt: T1 }), bookmark("c", { updatedAt: T0 })]);
    const b = file([bookmark("b", { updatedAt: T2 }), bookmark("a", { updatedAt: T0 })]);
    expect(serialize(merge(a, b, { now: NOW }))).toBe(serialize(merge(b, a, { now: NOW })));
  });
});
