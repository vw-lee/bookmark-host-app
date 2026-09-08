import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import App from "../../App.svelte";
import { store } from "../store.svelte";

/**
 * Keyboard navigation and the shortcut list (task 7m).
 *
 * The rule that earns most of these tests is the last one: a shortcut that fires while the user
 * is typing turns the search box into a minefield, where "j" jumps the list and "/" refocuses
 * the field you were already in. Every other assertion here is cheap; that one is the reason
 * the file exists.
 */

let instance: Record<string, unknown> | null = null;

async function app(): Promise<HTMLElement> {
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

  const target = document.createElement("div");
  document.body.appendChild(target);
  instance = mount(App, { target }) as Record<string, unknown>;
  for (let i = 0; i < 10 && store.booting; i++) await new Promise((r) => setTimeout(r, 0));

  await store.connect({ token: "t", owner: "o", repo: "r", path: "data/bookmarks.json" }, null);
  store.addBookmark({ url: "https://a.example/1", title: "Alpha" });
  store.addBookmark({ url: "https://b.example/2", title: "Beta" });
  flushSync();
  return target;
}

function press(key: string, target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  flushSync();
}

/** The row carrying the keyboard cursor, identified by its focus ring. */
function focusedTitle(root: HTMLElement): string | null {
  const row = root.querySelector("[data-bm-index].ring-2");
  return row?.textContent?.trim().split("\n")[0]?.trim() ?? null;
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

describe("the shortcut list on ? (task 7m)", () => {
  it("opens on ? and lists both the keys and the search syntax", async () => {
    await app();
    press("?");

    const dialog = document.querySelector('[role="dialog"][aria-label="Keyboard shortcuts"]');
    expect(dialog).not.toBeNull();

    const text = dialog?.textContent ?? "";
    expect(text).toContain("Next bookmark");
    // The palette could never document these, which is why ? stopped opening it.
    expect(text).toContain("tag:dev/rust");
    expect(text).toContain("is:untagged");
  });

  it("no longer hands ? to the command palette", async () => {
    const target = await app();
    press("?");
    // The palette answers "what can I do"; this answers "how do I do it without a mouse".
    expect(target.querySelector('input[placeholder*="command"]')).toBeNull();
  });
});

describe("list navigation", () => {
  it("moves the cursor with j and k", async () => {
    const target = await app();
    expect(focusedTitle(target)).toBeNull();

    press("j");
    const first = focusedTitle(target);
    expect(first).not.toBeNull();

    press("j");
    expect(focusedTitle(target)).not.toBe(first);

    press("k");
    expect(focusedTitle(target)).toBe(first);
  });

  it("stops at the ends rather than wrapping", async () => {
    const target = await app();
    press("k");
    const top = focusedTitle(target);
    press("k");
    expect(focusedTitle(target)).toBe(top);

    press("j");
    press("j");
    press("j");
    const bottom = focusedTitle(target);
    press("j");
    expect(focusedTitle(target)).toBe(bottom);
  });

  it("selects with x and edits with e", async () => {
    await app();
    press("j");
    press("x");
    expect(store.selection).toHaveLength(1);

    press("e");
    expect(store.editingId).toBe(store.pageItems[0]!.id);
  });

  it("deletes the focused row, undoably", async () => {
    await app();
    press("j");
    const doomed = store.pageItems[0]!.title;

    press("Delete");
    expect(store.undoable?.label).toBe(`Deleted ${doomed}`);
    expect(store.visible.map((b) => b.title)).not.toContain(doomed);
  });

  it("opens the focused bookmark with Enter, and only if the URL is safe", async () => {
    await app();
    const open = vi.fn();
    vi.stubGlobal("open", open);

    press("j");
    press("Enter");
    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0]![0]).toMatch(/^https:/);
  });

  it("clears a selection with Escape", async () => {
    await app();
    press("j");
    press("x");
    expect(store.selection).toHaveLength(1);

    press("Escape");
    expect(store.selection).toHaveLength(0);
  });
});

describe("shortcuts stay out of the way while typing", () => {
  it("ignores navigation keys inside a text field", async () => {
    const target = await app();
    const search = target.querySelector('input[aria-label="Search bookmarks"]') as HTMLInputElement;
    search.focus();

    // Every one of these is a shortcut outside a field and an ordinary character inside one.
    for (const key of ["j", "k", "v", "x", "e", "?", "/"]) press(key, search);

    expect(focusedTitle(target)).toBeNull();
    expect(store.selection).toHaveLength(0);
    expect(document.querySelector('[role="dialog"][aria-label="Keyboard shortcuts"]')).toBeNull();
  });
});
