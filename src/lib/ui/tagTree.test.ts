import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import TagTree from "./TagTree.svelte";

/**
 * The tag sidebar's filter box (task 7q, D26), mounted.
 *
 * `tagFilter.test.ts` proves the matching; this file proves the sidebar wires it up — that
 * typing narrows the rendered buttons, that context ancestors are marked as such, and that
 * Enter and Escape do what the `?` dialog says they do. The Escape case matters most: it has
 * to stop at the box, or the app-level handler behind it drops the user's selection as well.
 */

let instance: Record<string, unknown> | null = null;

afterEach(() => {
  if (instance) unmount(instance);
  instance = null;
  document.body.innerHTML = "";
});

function counts(...tags: string[]): Map<string, { exact: number; total: number }> {
  const map = new Map<string, { exact: number; total: number }>();
  for (const tag of tags) {
    const parts = tag.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const node = parts.slice(0, i).join("/");
      const entry = map.get(node) ?? { exact: 0, total: 0 };
      entry.total += 1;
      if (i === parts.length) entry.exact += 1;
      map.set(node, entry);
    }
  }
  return map;
}

function render(onSelect = vi.fn()): { root: HTMLElement; onSelect: ReturnType<typeof vi.fn> } {
  const target = document.createElement("div");
  document.body.appendChild(target);
  instance = mount(TagTree, {
    target,
    props: {
      counts: counts("dev/rust/async", "dev/web", "reading-list", "recipes"),
      selected: null,
      onSelect,
      totalCount: 4,
    },
  }) as Record<string, unknown>;
  flushSync();
  return { root: target, onSelect };
}

function filterBox(root: HTMLElement): HTMLInputElement {
  return root.querySelector('input[aria-label="Filter tags"]') as HTMLInputElement;
}

function type(root: HTMLElement, text: string) {
  const input = filterBox(root);
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

function press(root: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  filterBox(root).dispatchEvent(event);
  flushSync();
  return event;
}

function shownTags(root: HTMLElement): string[] {
  return [...root.querySelectorAll('ul[aria-label="Tags"] button')].map(
    (b) => b.getAttribute("title")?.match(/tagged exactly (\S+)/)?.[1] ?? "",
  );
}

describe("TagTree filter (7q)", () => {
  it("shows the whole tree before anything is typed", () => {
    const { root } = render();
    expect(shownTags(root)).toEqual([
      "dev",
      "dev/rust",
      "dev/rust/async",
      "dev/web",
      "reading-list",
      "recipes",
    ]);
  });

  it("narrows to matches plus their ancestors, marking the ancestors", () => {
    const { root } = render();
    type(root, "async");
    expect(shownTags(root)).toEqual(["dev", "dev/rust", "dev/rust/async"]);

    const marks = [...root.querySelectorAll('ul[aria-label="Tags"] button')].map((b) =>
      b.getAttribute("data-tag-match"),
    );
    expect(marks).toEqual(["false", "false", "true"]);
  });

  it("says so when nothing matches", () => {
    const { root } = render();
    type(root, "zzz");
    expect(shownTags(root)).toEqual([]);
    expect(root.textContent).toContain("No tags match");
  });

  it("selects the best match on Enter", () => {
    const { root, onSelect } = render();
    type(root, "rec");
    press(root, "Enter");
    expect(onSelect).toHaveBeenCalledWith("recipes");
  });

  it("does nothing on Enter when the box is empty", () => {
    const { root, onSelect } = render();
    press(root, "Enter");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clears on Escape without letting the key reach the app", () => {
    const { root } = render();
    type(root, "rust");
    expect(shownTags(root)).toHaveLength(3);

    const seenByWindow = vi.fn();
    window.addEventListener("keydown", seenByWindow);
    const event = press(root, "Escape");
    window.removeEventListener("keydown", seenByWindow);

    expect(event.defaultPrevented).toBe(true);
    expect(seenByWindow).not.toHaveBeenCalled();
    expect(filterBox(root).value).toBe("");
    expect(shownTags(root)).toHaveLength(6);
  });

  it("offers a clear button only while there is text to clear", () => {
    const { root } = render();
    expect(root.querySelector('[aria-label="Clear tag filter"]')).toBeNull();
    type(root, "dev");
    const clear = root.querySelector('[aria-label="Clear tag filter"]') as HTMLButtonElement;
    expect(clear).not.toBeNull();
    clear.click();
    flushSync();
    expect(filterBox(root).value).toBe("");
  });
});
