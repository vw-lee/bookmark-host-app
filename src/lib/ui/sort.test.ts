import { describe, it, expect } from "vitest";
import { comparator, hostOf } from "./sort";
import type { Bookmark } from "../schema/types";

function bm(over: Partial<Bookmark>): Bookmark {
  return {
    id: "01J0000000000000000000000A",
    url: "https://example.com/",
    urlKey: "example.com",
    title: "Example",
    description: "",
    notes: "",
    tags: [],
    favicon: null,
    pinned: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    enrichedAt: null,
    ...over,
  };
}

describe("hostOf", () => {
  it("strips www", () => {
    expect(hostOf("https://www.example.com/a")).toBe("example.com");
  });

  it("degrades to a truncated string rather than throwing", () => {
    expect(hostOf("nonsense")).toBe("nonsense");
  });
});

describe("comparator", () => {
  it("floats pinned records regardless of the sort key or direction", () => {
    const pinned = bm({ id: "01A", title: "Zzz", pinned: true });
    const plain = bm({ id: "01B", title: "Aaa" });
    for (const dir of ["asc", "desc"] as const) {
      expect([plain, pinned].sort(comparator("title", dir))[0]).toBe(pinned);
    }
  });

  it("orders titles naturally, not by code unit", () => {
    const two = bm({ id: "01A", title: "Chapter 2" });
    const ten = bm({ id: "01B", title: "Chapter 10" });
    expect([ten, two].sort(comparator("title", "asc"))).toEqual([two, ten]);
  });

  it("sorts accented titles where a reader expects rather than after Z", () => {
    const a = bm({ id: "01A", title: "Zebra" });
    const e = bm({ id: "01B", title: "Éclair" });
    expect([a, e].sort(comparator("title", "asc"))[0]).toBe(e);
  });

  it("reproduces the original default order — pinned first, then newest added", () => {
    const older = bm({ id: "01A" });
    const newer = bm({ id: "01Z" });
    expect([older, newer].sort(comparator("added", "desc"))).toEqual([newer, older]);
  });

  it("sorts by host, ignoring www", () => {
    const alpha = bm({ id: "01A", url: "https://www.alpha.com/" });
    const beta = bm({ id: "01B", url: "https://beta.com/" });
    expect([beta, alpha].sort(comparator("host", "asc"))).toEqual([alpha, beta]);
  });

  it("sorts by updatedAt", () => {
    const old = bm({ id: "01A", updatedAt: "2025-01-01T00:00:00.000Z" });
    const fresh = bm({ id: "01B", updatedAt: "2026-06-01T00:00:00.000Z" });
    expect([old, fresh].sort(comparator("updated", "desc"))).toEqual([fresh, old]);
  });

  it("breaks ties deterministically so pagination cannot shuffle", () => {
    const a = bm({ id: "01A", title: "Same" });
    const b = bm({ id: "01B", title: "Same" });
    expect([a, b].sort(comparator("title", "asc"))).toEqual([b, a].sort(comparator("title", "asc")));
  });

  it("treats an unparseable updatedAt as oldest rather than throwing", () => {
    const broken = bm({ id: "01A", updatedAt: "not-a-date" });
    const fine = bm({ id: "01B", updatedAt: "2026-01-01T00:00:00.000Z" });
    expect([broken, fine].sort(comparator("updated", "desc"))).toEqual([fine, broken]);
  });
});
