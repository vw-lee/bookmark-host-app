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
 * D13 (PIN-wrapping the token via WebCrypto) is still open and would sit behind this same
 * interface without changing callers.
 */

export type StorageMode = "session" | "local";

const TOKEN_KEY = "bm.token";
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
  return safeGet(local, MODE_KEY) === "local" ? "local" : "session";
}

/** Load the saved connection, checking both stores so a mode change never orphans a token. */
export function loadConnection(): Connection | null {
  const { session, local } = stores();
  const mode = getStorageMode();
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

/** Remove the token from both stores, leaving the non-secret target in place. */
export function clearToken(): void {
  const { session, local } = stores();
  safeRemove(session, TOKEN_KEY);
  safeRemove(local, TOKEN_KEY);
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
