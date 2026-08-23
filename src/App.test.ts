import { describe, it, expect, afterEach } from "vitest";
import { mount, unmount } from "svelte";
import App from "./App.svelte";

/**
 * Smoke test: the app actually mounts and renders. Unit tests would all pass even if the
 * component tree failed to compile or the shell threw on first render, so this asserts the
 * one thing they cannot.
 */

let instance: Record<string, unknown> | null = null;

afterEach(() => {
  if (instance) unmount(instance);
  instance = null;
  document.body.innerHTML = "";
});

function render(): HTMLElement {
  const target = document.createElement("div");
  document.body.appendChild(target);
  instance = mount(App, { target }) as Record<string, unknown>;
  return target;
}

describe("App shell", () => {
  it("mounts and shows first-run setup when no connection is stored", () => {
    const target = render();
    const text = target.textContent ?? "";

    expect(text).toContain("Bookmarks");
    // The setup flow must name what it is asking for and why (task 1a).
    expect(text).toContain("private GitHub repository");
    expect(text).toContain("Contents: Read and write");
  });

  it("states the shared-origin risk on the persistent storage option (§5.5)", () => {
    // The localStorage opt-in is only defensible if the warning is actually in front of the
    // user at the moment they choose it.
    const text = render().textContent ?? "";
    expect(text).toContain("github.io");
    expect(text).toContain("shared");
  });

  it("renders a token field that does not echo the secret", () => {
    const target = render();
    const tokenField = target.querySelector('input[type="password"]');
    expect(tokenField).not.toBeNull();
    expect(tokenField?.getAttribute("autocomplete")).toBe("off");
  });
});
