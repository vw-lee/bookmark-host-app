import { describe, it, expect, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import BookmarkCard from "./BookmarkCard.svelte";
import BookmarkTile from "./BookmarkTile.svelte";
import BookmarkTable from "./BookmarkTable.svelte";
import BookmarkRow from "./BookmarkRow.svelte";
import type { Bookmark } from "../schema/types";

/**
 * Every view mode renders, and — the reason this file exists — every view mode independently
 * honours the §5.4 rule that an unsafe URL must never become a clickable anchor.
 *
 * The gate is a render-time check repeated in four components. A unit test of isSafeUrl cannot
 * catch a view that simply forgot to call it, which is exactly the mistake a new layout invites.
 */

function bm(over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "01J0000000000000000000000A",
    url: "https://rust-lang.org/learn",
    urlKey: "rust-lang.org/learn",
    title: "The Rust Book",
    description: "How to learn Rust",
    notes: "",
    tags: ["dev/rust"],
    favicon: null,
    pinned: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    deletedAt: null,
    enrichedAt: null,
    ...over,
  };
}

const noop = () => {};
let instance: Record<string, unknown> | null = null;

afterEach(() => {
  if (instance) unmount(instance);
  instance = null;
  document.body.innerHTML = "";
});

function render(component: unknown, props: Record<string, unknown>): HTMLElement {
  const target = document.createElement("div");
  document.body.appendChild(target);
  instance = mount(component as never, { target, props }) as Record<string, unknown>;
  flushSync();
  return target;
}

const single = { onTag: noop, onDelete: noop, onUpdate: noop };

describe("card view", () => {
  it("renders the bookmark with its generated tile", () => {
    const el = render(BookmarkCard, { bookmark: bm(), ...single });
    expect(el.textContent).toContain("The Rust Book");
    expect(el.textContent).toContain("rust-lang.org");
    // "rust-lang" is two words, so the tile shows both initials.
    expect(el.querySelector(".bm-tile")?.textContent?.trim()).toBe("RL");
  });

  it("links a safe URL", () => {
    const el = render(BookmarkCard, { bookmark: bm(), ...single });
    expect(el.querySelector('a[href="https://rust-lang.org/learn"]')).not.toBeNull();
  });

  it("refuses to make an unsafe URL clickable (§5.4)", () => {
    const el = render(BookmarkCard, { bookmark: bm({ url: "javascript:alert(1)" }), ...single });
    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toContain("unsafe link");
  });
});

describe("tile view", () => {
  it("renders as a launch target", () => {
    const el = render(BookmarkTile, { bookmark: bm(), onDelete: noop, onUpdate: noop });
    expect(el.textContent).toContain("The Rust Book");
    expect(el.querySelector('a[href="https://rust-lang.org/learn"]')).not.toBeNull();
  });

  it("refuses to make an unsafe URL clickable (§5.4)", () => {
    const el = render(BookmarkTile, {
      bookmark: bm({ url: "data:text/html,<script>x</script>" }),
      onDelete: noop,
      onUpdate: noop,
    });
    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toContain("unsafe link");
  });
});

describe("table view", () => {
  it("renders a row per bookmark with sortable, announced headers", () => {
    const el = render(BookmarkTable, { items: [bm()], ...single });
    expect(el.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(el.textContent).toContain("The Rust Book");
    // aria-sort is how a screen reader learns which column is ordering the table.
    const sorted = el.querySelectorAll('th[aria-sort]:not([aria-sort="none"])');
    expect(sorted.length).toBe(1);
  });

  it("refuses to make an unsafe URL clickable (§5.4)", () => {
    const el = render(BookmarkTable, { items: [bm({ url: "javascript:alert(1)" })], ...single });
    expect(el.querySelector("tbody a")).toBeNull();
    expect(el.textContent).toContain("unsafe");
  });
});

describe("row view", () => {
  it("still refuses an unsafe URL after the shared-component refactor (§5.4)", () => {
    const el = render(BookmarkRow, { bookmark: bm({ url: "javascript:alert(1)" }), ...single });
    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toContain("unsafe link");
  });
});
