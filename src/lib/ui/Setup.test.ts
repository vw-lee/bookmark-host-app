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

/**
 * Fill the form. `mode` selects the storage radio — PIN is the default now (D13), and it
 * refuses to submit without a passphrase, so tests of the connection path pick "session".
 */
function fill(target: HTMLElement, mode: "session" | "pin" = "session", pin = "") {
  const radio = target.querySelector(`input[type="radio"][value="${mode}"]`) as HTMLInputElement;
  radio.click();
  flushSync();

  const text = Array.from(
    target.querySelectorAll('input:not([type="radio"]):not([type="password"])'),
  ) as HTMLInputElement[];
  text[0]!.value = "victor";
  text[0]!.dispatchEvent(new Event("input", { bubbles: true }));
  text[1]!.value = "bookmarks";
  text[1]!.dispatchEvent(new Event("input", { bubbles: true }));

  const passwords = Array.from(
    target.querySelectorAll('input[type="password"]'),
  ) as HTMLInputElement[];
  passwords[0]!.value = "ghp_bad";
  passwords[0]!.dispatchEvent(new Event("input", { bubbles: true }));
  if (mode === "pin" && passwords[1]) {
    passwords[1]!.value = pin;
    passwords[1]!.dispatchEvent(new Event("input", { bubbles: true }));
  }
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

    const text = Array.from(
      target.querySelectorAll('input:not([type="radio"]):not([type="password"])'),
    ) as HTMLInputElement[];
    expect(text[0]!.value).toBe("victor");
    expect(text[1]!.value).toBe("bookmarks");
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

describe("Setup — PIN mode (D13)", () => {
  it("refuses to submit without a long enough passphrase", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(String(url));
        return new Response(JSON.stringify({ name: "bookmarks" }), { status: 200 });
      }),
    );

    const target = await render();
    fill(target, "pin", "12345");
    await submit(target);

    // Rejected locally — no request should have been made at all.
    expect(seen).toHaveLength(0);
    expect(target.textContent).toContain("at least 6 characters");
  });

  it("stores the token wrapped, never in the clear", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 2) return new Response(JSON.stringify({}), { status: 404 });
        if (call >= 3)
          return new Response(JSON.stringify({ content: { sha: "s" } }), { status: 200 });
        return new Response(JSON.stringify({ name: "bookmarks" }), { status: 200 });
      }),
    );

    const target = await render();
    fill(target, "pin", "correct-horse-battery");
    await submit(target);
    // PBKDF2 at 600k iterations is deliberately slow; poll rather than guess a delay.
    for (let i = 0; i < 100 && localStorage.getItem("bm.token.enc") === null; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    flushSync();

    const dump = JSON.stringify(localStorage);
    expect(dump).not.toContain("ghp_bad");
    expect(localStorage.getItem("bm.token.enc")).not.toBeNull();
    expect(localStorage.getItem("bm.token")).toBeNull();
  });
});

describe("Setup — reconnect rather than re-setup (D16)", () => {
  it("skips the first-run wall when the repository is already known", async () => {
    // The state left behind by a session-mode token that died with the tab: the repo is
    // configured, only the token is missing.
    localStorage.setItem(
      "bm.target",
      JSON.stringify({ owner: "victor", repo: "bookmarks", path: "data/bookmarks.json" }),
    );

    const target = await render();
    const text = target.textContent ?? "";

    // The three-step instructions are collapsed away — this is one token, not a setup.
    expect(text).not.toContain("Create a private repository");
    expect(text).toContain("Reconnect");
    // Everything the user already entered is still there.
    const fields = Array.from(
      target.querySelectorAll('input:not([type="radio"]):not([type="password"])'),
    ) as HTMLInputElement[];
    expect(fields[0]!.value).toBe("victor");
    expect(fields[1]!.value).toBe("bookmarks");
    expect(fields[2]!.value).toBe("data/bookmarks.json");
  });

  it("says plainly when the token is the thing that expired", async () => {
    localStorage.setItem(
      "bm.target",
      JSON.stringify({ owner: "victor", repo: "bookmarks", path: "data/bookmarks.json" }),
    );
    localStorage.setItem("bm.token.expired", "1");

    const target = await render();
    // restore() is what reads the expiry flag, and it settles a tick after mount.
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
    const text = target.textContent ?? "";
    expect(text).toContain("expired");
    // And it must reassure rather than imply data loss.
    expect(text).toContain("safe on this device");
  });

  it("still offers a way back to a full setup", async () => {
    localStorage.setItem(
      "bm.target",
      JSON.stringify({ owner: "victor", repo: "bookmarks", path: "data/bookmarks.json" }),
    );

    const target = await render();
    const startOver = Array.from(target.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("different repository"),
    );
    expect(startOver).toBeDefined();

    startOver!.click();
    flushSync();
    expect(target.textContent).toContain("Create a private repository");
  });
});
