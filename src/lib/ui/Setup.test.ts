import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import App from "../../App.svelte";
import { store } from "../store.svelte";

/**
 * Regression tests for the first-run form.
 *
 * The reported symptom was: press Connect, the form vanishes, nothing happens. The cause is
 * structural — the shell swapped Setup out the instant status became "loading", destroying the
 * component mid-submit along with the typed token and the error message it was about to show.
 */

let instance: Record<string, unknown> | null = null;

async function render(): Promise<HTMLElement> {
  const target = document.createElement("div");
  document.body.appendChild(target);
  instance = mount(App, { target }) as Record<string, unknown>;
  // restore() is async; the shell shows a boot screen until it settles.
  for (let i = 0; i < 10 && store.booting; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
  return target;
}

function fill(target: HTMLElement) {
  const set = (selector: string, value: string) => {
    const input = target.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const inputs = Array.from(target.querySelectorAll("input")) as HTMLInputElement[];
  inputs[0]!.value = "victor";
  inputs[0]!.dispatchEvent(new Event("input", { bubbles: true }));
  inputs[1]!.value = "bookmarks";
  inputs[1]!.dispatchEvent(new Event("input", { bubbles: true }));
  set('input[type="password"]', "ghp_bad");
  flushSync();
}

async function submit(target: HTMLElement) {
  const form = target.querySelector("form") as HTMLFormElement;
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  // Let the probe promise settle.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
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

describe("Setup — failed connection", () => {
  it("keeps the form on screen and explains the failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 401 })),
    );

    const target = await render();
    fill(target);
    await submit(target);

    // The form must still be there.
    expect(target.querySelector('input[type="password"]')).not.toBeNull();
    // And it must say what went wrong, rather than silently resetting.
    expect(target.textContent).toContain("expired");
  });

  it("does not wipe the owner and repository the user typed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 404 })),
    );

    const target = await render();
    fill(target);
    await submit(target);

    const inputs = Array.from(target.querySelectorAll("input")) as HTMLInputElement[];
    expect(inputs[0]!.value).toBe("victor");
    expect(inputs[1]!.value).toBe("bookmarks");
  });

  it("reports a repository that cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 404 })),
    );

    const target = await render();
    fill(target);
    await submit(target);

    expect(target.textContent).toContain("Repository not found");
  });

  it("reports a network failure rather than appearing to do nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const target = await render();
    fill(target);
    await submit(target);

    expect(target.querySelector('input[type="password"]')).not.toBeNull();
    expect(target.textContent).toContain("No connection to GitHub");
  });
});

describe("Setup — successful connection", () => {
  it("leaves the setup screen for the bookmark list", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        // 1: repo probe, 2: file read (missing), 3: bootstrap write
        if (call === 2) return new Response(JSON.stringify({}), { status: 404 });
        if (call >= 3)
          return new Response(JSON.stringify({ content: { sha: "s" } }), { status: 200 });
        return new Response(JSON.stringify({ name: "bookmarks" }), { status: 200 });
      }),
    );

    const target = await render();
    fill(target);
    await submit(target);
    await new Promise((r) => setTimeout(r, 10));
    flushSync();

    expect(target.querySelector('input[type="password"]')).toBeNull();
    expect(target.textContent).toContain("No bookmarks yet");
  });
});
