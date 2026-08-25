/**
 * Token storage (README §5.5, decision D8).
 *
 * D10 resolved as "no custom domain", so this app runs on *.github.io — an origin shared with
 * every other project on the account. sessionStorage is therefore the default: the token dies
 * with the browsing context, and a sibling page has a much smaller window to reach it.
 *
 * localStorage remains available as an explicit opt-in because the alternative on mobile is
 * re-pasting a 93-character PAT after every cold launch, which nobody does. The warning text
 * lives with the UI that offers the choice, not here.
 *
 * D13 adds a third mode: the token wrapped under a passphrase via WebCrypto, which is the only
 * mode that survives a cold launch without leaving a usable secret on a shared origin. See
 * tokenCrypto.ts for exactly what that does and does not defend against.
 *
 * D16 makes that mode livable. Setup is a wall — three steps and a PAT form most people have
 * never seen — so it must happen ONCE, not every time a long-lived page goes stale. Two pieces
 * of state exist for that:
 *
 *   - the unlock cache: the decrypted token in sessionStorage, so a reload, or a tab the
 *     browser discarded and later restored, comes back without asking for the passphrase
 *     again. It dies with the browsing context — the same exposure "session" mode already
 *     accepts — and it is per-tab, so a sibling page in another tab cannot read it at all.
 *   - the expired flag: set when GitHub answers 401. The wrapped blob holds that same dead
 *     token, so asking for a passphrase first would waste the user's time; the flag routes
 *     the next launch straight to "paste a new token" instead.
 */

import { wrapToken, unwrapToken, isWrappedToken, type WrappedToken } from "./tokenCrypto";

/**
 * "pin" wraps the token with a passphrase before storing it in localStorage (D13). It is the
 * only mode that survives a cold launch without leaving a usable secret on a shared origin.
 */
export type StorageMode = "session" | "local" | "pin";

const TOKEN_KEY = "bm.token";
const WRAPPED_KEY = "bm.token.enc";
const TARGET_KEY = "bm.target";
const MODE_KEY = "bm.mode";
/** Set when GitHub rejected the stored token, so the next launch skips straight to reconnect. */
const EXPIRED_KEY = "bm.token.expired";
/** The user's answer to "stay unlocked in this tab", remembered across sessions. */
const REMEMBER_KEY = "bm.unlock.remember";

export interface Connection {
  token: string;
  owner: string;
  repo: string;
  path: string;
}

/**
 * Storage access can throw outright — Safari in private mode, and any browser configured to
 * block site data. Every read and write is guarded so a blocked store degrades to "not
 * connected" rather than a blank page.
 */
function safeGet(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(store: Storage | undefined, key: string, value: string): boolean {
  try {
    store?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(store: Storage | undefined, key: string): void {
  try {
    store?.removeItem(key);
  } catch {
    /* nothing useful to do */
  }
}

function stores(): { session: Storage | undefined; local: Storage | undefined } {
  return {
    session: typeof sessionStorage !== "undefined" ? sessionStorage : undefined,
    local: typeof localStorage !== "undefined" ? localStorage : undefined,
  };
}

export function getStorageMode(): StorageMode {
  const { local } = stores();
  const stored = safeGet(local, MODE_KEY);
  return stored === "local" || stored === "pin" ? stored : "session";
}

/** Is there a PIN-wrapped token waiting to be unlocked? */
export function hasWrappedToken(): boolean {
  return loadWrapped() !== null;
}

/**
 * Has setup already been completed on this device?
 *
 * A saved target plus a token in any form. This is the guard that keeps the first-run wall
 * from reappearing: everything short of an explicit disconnect is a reconnect, not a setup.
 */
export function hasCompletedSetup(): boolean {
  return loadTarget() !== null && (hasWrappedToken() || loadConnection() !== null);
}

function loadWrapped(): WrappedToken | null {
  const { local } = stores();
  const raw = safeGet(local, WRAPPED_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isWrappedToken(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Unlock a stored token. Returns null for a wrong passphrase. */
export async function unlockConnection(pin: string): Promise<Connection | null> {
  const wrapped = loadWrapped();
  const target = loadTarget();
  if (!wrapped || !target) return null;

  const token = await unwrapToken(wrapped, pin);
  return token ? { token, ...target } : null;
}

/**
 * Keep the decrypted token for the rest of this browsing context (D16).
 *
 * This is what stops a reload — or a tab the OS discarded and then restored — from demanding
 * the passphrase again. sessionStorage is scoped to the one tab and cleared when it closes.
 */
export function cacheUnlockedToken(token: string): void {
  const { session } = stores();
  safeSet(session, TOKEN_KEY, token);
}

/** Drop the unlocked copy, returning to "passphrase required" without touching the wrapped blob. */
export function clearUnlockCache(): void {
  const { session } = stores();
  safeRemove(session, TOKEN_KEY);
}

/** Does the user want the unlock to persist for the tab? Defaults to yes. */
export function getRememberUnlock(): boolean {
  const { local } = stores();
  return safeGet(local, REMEMBER_KEY) !== "0";
}

export function setRememberUnlock(remember: boolean): void {
  const { local } = stores();
  safeSet(local, REMEMBER_KEY, remember ? "1" : "0");
  if (!remember) clearUnlockCache();
}

/**
 * GitHub rejected the stored token (401). Recorded rather than acted on immediately, because
 * the useful response — ask for a new token, keep everything else — belongs to the next
 * launch as much as to this one.
 */
export function markTokenExpired(): void {
  const { local } = stores();
  safeSet(local, EXPIRED_KEY, "1");
  clearUnlockCache();
}

export function isTokenExpired(): boolean {
  const { local } = stores();
  return safeGet(local, EXPIRED_KEY) === "1";
}

export function clearTokenExpired(): void {
  const { local } = stores();
  safeRemove(local, EXPIRED_KEY);
}

/** Load the saved connection, checking both stores so a mode change never orphans a token. */
export function loadConnection(): Connection | null {
  const { session, local } = stores();
  const mode = getStorageMode();
  const primary = mode === "local" ? local : session;

  // In PIN mode the only token that may be returned is the unlock cache in sessionStorage —
  // the wrapped blob still requires unlockConnection().
  const token =
    mode === "pin"
      ? safeGet(session, TOKEN_KEY)
      : (safeGet(primary, TOKEN_KEY) ?? safeGet(session, TOKEN_KEY));
  const targetRaw = safeGet(local, TARGET_KEY) ?? safeGet(session, TARGET_KEY);
  if (!token || !targetRaw) return null;

  try {
    const target = JSON.parse(targetRaw) as Omit<Connection, "token">;
    if (!target.owner || !target.repo || !target.path) return null;
    return { token, ...target };
  } catch {
    return null;
  }
}

/** Persist a connection. Returns false if storage is unavailable, so the UI can say so. */
export function saveConnection(connection: Connection, mode: StorageMode): boolean {
  if (mode === "pin") {
    throw new Error("Use saveWrappedConnection() for PIN mode — it needs the passphrase.");
  }
  const { session, local } = stores();
  const { token, ...target } = connection;

  // Clear every stored token first: switching modes must not leave a copy behind in the other
  // store, and a leftover wrapped blob would send the next launch to the unlock screen for a
  // token that is no longer the one in use.
  clearAllTokens();
  clearTokenExpired();

  const ok = safeSet(mode === "local" ? local : session, TOKEN_KEY, token);
  // The repo target is not a secret, so it persists in localStorage regardless of mode —
  // that way a session-mode user re-enters only the token, not the whole setup.
  safeSet(local, TARGET_KEY, JSON.stringify(target));
  safeSet(local, MODE_KEY, mode);
  if (!ok) safeSet(session, TOKEN_KEY, token);
  return ok;
}

/** Store the token wrapped under a passphrase (D13). */
export async function saveWrappedConnection(
  connection: Connection,
  pin: string,
): Promise<boolean> {
  const { local } = stores();
  const { token, ...target } = connection;
  const wrapped = await wrapToken(token, pin);

  clearAllTokens();
  clearTokenExpired();
  const ok = safeSet(local, WRAPPED_KEY, JSON.stringify(wrapped));
  safeSet(local, TARGET_KEY, JSON.stringify(target));
  safeSet(local, MODE_KEY, "pin");
  // The token just proved itself against the API, so this session starts unlocked.
  if (getRememberUnlock()) cacheUnlockedToken(token);
  return ok;
}

/**
 * Remove usable tokens, leaving the wrapped blob and the non-secret target in place.
 *
 * This is what an auth failure calls. Destroying the wrapped blob there is what used to throw
 * the user back to first-run setup: the repository was still known and the passphrase was
 * still good, but the app had forgotten that setup had ever happened (D16).
 */
export function clearToken(): void {
  const { session, local } = stores();
  safeRemove(session, TOKEN_KEY);
  safeRemove(local, TOKEN_KEY);
}

/** Remove the PIN-wrapped token. Only an explicit "start over" should reach this. */
export function clearWrappedToken(): void {
  const { local } = stores();
  safeRemove(local, WRAPPED_KEY);
}

function clearAllTokens(): void {
  clearToken();
  clearWrappedToken();
}

/** Full disconnect — token and target. */
export function clearConnection(): void {
  const { session, local } = stores();
  clearAllTokens();
  clearTokenExpired();
  safeRemove(session, TARGET_KEY);
  safeRemove(local, TARGET_KEY);
  safeRemove(local, MODE_KEY);
}

/** The saved repo target without its token, so setup can prefill after a session expires. */
export function loadTarget(): Omit<Connection, "token"> | null {
  const { session, local } = stores();
  const raw = safeGet(local, TARGET_KEY) ?? safeGet(session, TARGET_KEY);
  if (!raw) return null;
  try {
    const target = JSON.parse(raw) as Omit<Connection, "token">;
    return target.owner && target.repo && target.path ? target : null;
  } catch {
    return null;
  }
}
