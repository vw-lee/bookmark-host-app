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

/** Store the token wrapped under a passphrase (D13). */
export async function saveWrappedConnection(
  connection: Connection,
  pin: string,
): Promise<boolean> {
  const { local } = stores();
  const { token, ...target } = connection;
  const wrapped = await wrapToken(token, pin);

  clearToken();
  const ok = safeSet(local, WRAPPED_KEY, JSON.stringify(wrapped));
  safeSet(local, TARGET_KEY, JSON.stringify(target));
  safeSet(local, MODE_KEY, "pin");
  return ok;
}

/** Load the saved connection, checking both stores so a mode change never orphans a token. */
export function loadConnection(): Connection | null {
  const { session, local } = stores();
  const mode = getStorageMode();
  // A PIN-wrapped token is never returned here — it requires unlockConnection().
  if (mode === "pin") return null;
  const primary = mode === "local" ? local : session;

  const token = safeGet(primary, TOKEN_KEY) ?? safeGet(session, TOKEN_KEY);
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

  // Clear both first: switching modes must not leave a copy behind in the other store.
  clearToken();

  const ok = safeSet(mode === "local" ? local : session, TOKEN_KEY, token);
  // The repo target is not a secret, so it persists in localStorage regardless of mode —
  // that way a session-mode user re-enters only the token, not the whole setup.
  safeSet(local, TARGET_KEY, JSON.stringify(target));
  safeSet(local, MODE_KEY, mode);
  if (!ok) safeSet(session, TOKEN_KEY, token);
  return ok;
}

/** Remove the token from every store, leaving the non-secret target in place. */
export function clearToken(): void {
  const { session, local } = stores();
  safeRemove(session, TOKEN_KEY);
  safeRemove(local, TOKEN_KEY);
  safeRemove(local, WRAPPED_KEY);
}

/** Full disconnect — token and target. */
export function clearConnection(): void {
  const { session, local } = stores();
  clearToken();
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
