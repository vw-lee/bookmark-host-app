import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import App from "../../App.svelte";
import { store } from "../store.svelte";

/**
 * The single-viewport shell (D18).
 *
 * The bookmark UI is an application shell, not a document: it is exactly one viewport tall,
 * the page itself never scrolls, and the tag sidebar and the bookmark list each scroll on
 * their own. Chrome — header and pager — stays put.
 *
 * These assertions read as CSS-class checks, which is not usually worth testing. They are here
 * because the contract lives entirely in four easily-lost utilities: `h-dvh` and
 * `overflow-hidden` on the shell, and `min-h-0` on every flex ancestor of a scroll region.
 * Drop any one of them and the layout silently reverts to one long scrolling page — a change
 * no other test in this suite would notice, because every element still renders.
 */

let instance: Record<string, unknown> | null = null;

async function render(): Promise<HTMLElement> {
  const target = document.createElement("div");
  document.body.appendChild(target);
  instance = mount(App, { target }) as Record<string, unknown>;
  for (let i = 0; i < 10 && store.booting; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
  return target;
}

/** Connect against a scripted API so the app renders its list rather than the setup form. */
async function connected(): Promise<HTMLElement> {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      call += 1;
      if (call === 2) return new Response(JSON.stringify({}), { status: 404 });
      if (call >= 3) return new Response(JSON.stringify({ content: { sha: "s" } }), { status: 200 });
      return new Response(JSON.stringify({ name: "bookmarks" }), { status: 200 });
    }),
  );

  const target = await render();
  await store.connect({ token: "t", owner: "o", repo: "r", path: "data/bookmarks.json" }, null);
  store.addBookmark({ url: "https://rust-lang.org/learn", title: "The Rust Book", tags: ["dev/rust"] });
  flushSync();
  return target;
}

beforeEach(() => {
  store.disconnect();
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  if (instance) unmount(instance);
  instance = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("app shell — one viewport, no page scroll (D18)", () => {
  it("pins the shell to the viewport height", async () => {
    const target = await connected();
    const shell = target.firstElementChild as HTMLElement;

    expect(shell.className).toContain("h-dvh");
    expect(shell.className).toContain("overflow-hidden");
  });

  it("gives the bookmark list its own scroll region", async () => {
    const target = await connected();
    const list = target.querySelector("#bookmark-list") as HTMLElement;

    expect(list).not.toBeNull();
    expect(list.className).toContain("bm-scroll");
    // Without min-h-0 the flex child refuses to shrink and the region never scrolls.
    expect(list.className).toContain("min-h-0");
    // The skip link targets it, so it has to be able to take focus.
    expect(list.getAttribute("tabindex")).toBe("-1");
  });

  it("gives the tag sidebar its own scroll region, with All pinned above it", async () => {
    const target = await connected();
    const tagList = target.querySelector("nav ul") as HTMLElement;

    expect(tagList.className).toContain("bm-scroll");
    expect(tagList.className).toContain("min-h-0");

    // "All" sits outside the scrolling list, so it stays reachable in a deep tag tree.
    const all = target.querySelector("nav > button") as HTMLElement;
    expect(all.textContent).toContain("All");
    expect(all.className).toContain("shrink-0");
  });

  it("keeps every flex ancestor of a scroll region shrinkable", async () => {
    const target = await connected();
    const list = target.querySelector("#bookmark-list") as HTMLElement;

    // Walk up to the shell: each flex box in between must carry min-h-0, or the chain breaks
    // at the first one that does not and nothing below it scrolls.
    const shell = target.firstElementChild as HTMLElement;
    for (let node = list.parentElement; node && node !== shell; node = node.parentElement) {
      if (node.className.includes("flex-1")) {
        expect(node.className).toContain("min-h-0");
      }
    }
  });

  it("leaves the pager outside the scroll region", async () => {
    const target = await connected();
    const list = target.querySelector("#bookmark-list") as HTMLElement;
    const pager = target.querySelector('nav[aria-label="Pagination"]');

    // Only rendered past one page, but when it is, it must not be inside the scroller.
    if (pager) expect(list.contains(pager)).toBe(false);
  });
});

describe("app shell — the full-page forms still scroll", () => {
  it("does not trap setup in a fixed-height box", async () => {
    // Setup is taller than a phone screen; clipping it would put Connect out of reach.
    const target = await render();
    const shell = target.firstElementChild as HTMLElement;

    expect(store.needsSetup).toBe(true);
    expect(shell.className).not.toContain("h-dvh");
    expect(shell.className).not.toContain("overflow-hidden");
  });
});
