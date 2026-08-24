import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppStore } from "../store.svelte";
import { encodeBase64 } from "../api/base64";
import { serialize } from "../schema/serialize";
import { emptyFile } from "../schema/types";

/** Pagination (task 7c) — not virtual scrolling, see §1.2. */

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

describe("pagination", () => {
  let store: AppStore;

  beforeEach(async () => {
    store = await connected();
    for (let i = 0; i < 120; i++) {
      store.addBookmark({ url: `https://example.com/p${i}`, title: `Item ${i}` });
    }
  });

  it("splits the collection into pages", () => {
    expect(store.visible).toHaveLength(120);
    expect(store.pageItems).toHaveLength(50);
    expect(store.pageCount).toBe(3);
  });

  it("returns the right slice for a later page", () => {
    store.page = 2;
    expect(store.pageItems).toHaveLength(20);
  });

  it("reports one page for an empty collection rather than zero", () => {
    // pageCount of 0 would make "Page 1 of 0" appear.
    const fresh = new AppStore();
    expect(fresh.pageCount).toBe(1);
    expect(fresh.pageItems).toEqual([]);
  });

  it("clamps a page left past the end after filtering", () => {
    store.page = 2;
    store.query = "Item 3";
    store.clampPage();
    expect(store.page).toBeLessThan(store.pageCount);
    expect(store.pageItems.length).toBeGreaterThan(0);
  });

  it("respects a changed page size", () => {
    store.pageSize = 25;
    expect(store.pageCount).toBe(5);
    expect(store.pageItems).toHaveLength(25);
  });
});

describe("clampPage — shrinking collections", () => {
  it("pulls the user back when deletions empty the page they are on", async () => {
    const store = await connected();
    for (let i = 0; i < 60; i++) {
      store.addBookmark({ url: `https://example.com/p${i}`, title: `Item ${i}` });
    }
    store.page = 1;
    expect(store.pageItems).toHaveLength(10);

    // Delete everything on the last page.
    for (const b of [...store.pageItems]) store.deleteBookmark(b.id);
    store.clampPage();

    expect(store.page).toBe(0);
    expect(store.pageItems.length).toBeGreaterThan(0);
  });

  it("is a no-op when the current page is still valid", async () => {
    const store = await connected();
    for (let i = 0; i < 120; i++) {
      store.addBookmark({ url: `https://example.com/p${i}`, title: `Item ${i}` });
    }
    store.page = 1;
    store.clampPage();
    expect(store.page).toBe(1);
  });
});
