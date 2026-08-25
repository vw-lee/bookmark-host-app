import { describe, it, expect, beforeEach } from "vitest";
import {
  saveConnection,
  saveWrappedConnection,
  loadConnection,
  loadTarget,
  unlockConnection,
  hasWrappedToken,
  hasCompletedSetup,
  cacheUnlockedToken,
  clearUnlockCache,
  getRememberUnlock,
  setRememberUnlock,
  markTokenExpired,
  isTokenExpired,
  clearTokenExpired,
  clearToken,
  clearConnection,
  getStorageMode,
} from "./tokenStore";

/**
 * Regression tests for D16.
 *
 * The reported symptom was: a page left open long enough goes stale, and the app comes back
 * at the first-run setup screen demanding a new personal access token — even though nothing
 * about the repository or the passphrase had changed. Setup is a three-step wall, and paying
 * it repeatedly is the single worst thing this app did.
 *
 * Each test here pins one step of "setup happens once".
 */

const CONNECTION = {
  token: "github_pat_11ABCDEF0abcdefghijklmnop_qrstuvwxyz0123456789ABCDEFGHIJK",
  owner: "victor",
  repo: "bookmarks",
  path: "data/bookmarks.json",
};
const PIN = "correct-horse-battery";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("tokenStore — an auth failure must not undo setup (D16)", () => {
  it("keeps the wrapped token and the target when the plaintext copy is dropped", async () => {
    await saveWrappedConnection(CONNECTION, PIN);
    clearToken();

    // This is the exact state after GitHub answers 401: the passphrase still works and the
    // repository is still known, so there is nothing to set up again.
    expect(hasWrappedToken()).toBe(true);
    expect(loadTarget()).toEqual({ owner: "victor", repo: "bookmarks", path: "data/bookmarks.json" });
    expect(hasCompletedSetup()).toBe(true);
    expect(await unlockConnection(PIN)).toEqual(CONNECTION);
  });

  it("records the expiry so the next launch asks for a token, not a passphrase", async () => {
    await saveWrappedConnection(CONNECTION, PIN);
    expect(isTokenExpired()).toBe(false);

    markTokenExpired();
    expect(isTokenExpired()).toBe(true);
    // The dead token is not left unlocked for the rest of the session.
    expect(loadConnection()).toBeNull();

    // Saving a working token clears the flag again.
    await saveWrappedConnection(CONNECTION, PIN);
    expect(isTokenExpired()).toBe(false);
  });

  it("clears the flag explicitly", () => {
    markTokenExpired();
    clearTokenExpired();
    expect(isTokenExpired()).toBe(false);
  });
});

describe("tokenStore — the unlock cache (D16)", () => {
  it("starts the session unlocked after a successful setup", async () => {
    await saveWrappedConnection(CONNECTION, PIN);
    // A reload lands here: no passphrase prompt, because this tab is already unlocked.
    expect(loadConnection()).toEqual(CONNECTION);
    expect(getStorageMode()).toBe("pin");
  });

  it("keeps the unlocked copy out of localStorage", async () => {
    await saveWrappedConnection(CONNECTION, PIN);
    expect(JSON.stringify(localStorage)).not.toContain(CONNECTION.token);
    expect(sessionStorage.getItem("bm.token")).toBe(CONNECTION.token);
  });

  it("returns to locked when the cache is dropped, without losing the token", async () => {
    await saveWrappedConnection(CONNECTION, PIN);
    clearUnlockCache();

    expect(loadConnection()).toBeNull();
    expect(hasWrappedToken()).toBe(true);
  });

  it("honours the user turning the cache off", async () => {
    setRememberUnlock(false);
    expect(getRememberUnlock()).toBe(false);

    await saveWrappedConnection(CONNECTION, PIN);
    // Opted out: the passphrase is required again on the next load.
    expect(loadConnection()).toBeNull();
    expect(hasWrappedToken()).toBe(true);

    setRememberUnlock(true);
    cacheUnlockedToken(CONNECTION.token);
    expect(loadConnection()).toEqual(CONNECTION);
  });

  it("survives the preference default being unset", () => {
    expect(getRememberUnlock()).toBe(true);
  });
});

describe("tokenStore — switching modes leaves nothing behind", () => {
  it("drops the wrapped blob when a plaintext mode is chosen", async () => {
    await saveWrappedConnection(CONNECTION, PIN);
    saveConnection(CONNECTION, "session");

    // A leftover blob would send the next launch to an unlock screen for a token that is no
    // longer the one in use.
    expect(hasWrappedToken()).toBe(false);
    expect(getStorageMode()).toBe("session");
    expect(loadConnection()).toEqual(CONNECTION);
  });

  it("drops a plaintext token when the passphrase mode is chosen", async () => {
    saveConnection(CONNECTION, "local");
    expect(localStorage.getItem("bm.token")).not.toBeNull();

    await saveWrappedConnection(CONNECTION, PIN);
    expect(localStorage.getItem("bm.token")).toBeNull();
  });
});

describe("tokenStore — disconnect is the only thing that undoes setup", () => {
  it("removes every trace", async () => {
    await saveWrappedConnection(CONNECTION, PIN);
    markTokenExpired();
    clearConnection();

    expect(hasWrappedToken()).toBe(false);
    expect(loadTarget()).toBeNull();
    expect(loadConnection()).toBeNull();
    expect(hasCompletedSetup()).toBe(false);
    expect(isTokenExpired()).toBe(false);
  });

  it("reports setup as incomplete when only a target survives", () => {
    saveConnection(CONNECTION, "session");
    sessionStorage.removeItem("bm.token");

    // Session mode after the tab closes: the repository is known but no token is, so the form
    // still has to ask for one — the reconnect shape, not first run.
    expect(hasCompletedSetup()).toBe(false);
    expect(loadTarget()).not.toBeNull();
  });
});
