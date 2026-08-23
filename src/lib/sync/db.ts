/**
 * IndexedDB mirror and durable outbox (tasks 3b, 3c).
 *
 * DESIGN NOTE — why there is no operation log.
 *
 * README §9 describes the outbox as "a queue of pending ops". This implements it as a mirror of
 * the whole document plus a dirty flag instead, because the conflict model already makes an op
 * log redundant: every record carries `updatedAt`, and merge (§3.2) reconciles two documents
 * without needing to know which edits produced them. An offline edit wins its merge because its
 * timestamp is newer, not because it was replayed in order.
 *
 * A replayable op log would be strictly more machinery for the same outcome, and it would
 * introduce a failure mode this design cannot have: an op log that has drifted out of sync with
 * the document it describes. Recorded as D15.
 *
 * Everything here degrades to a no-op if IndexedDB is unavailable (private windows, blocked site
 * data). The app must work without it — just without offline durability.
 */
import type { BookmarkFile } from "../schema/types";

const DB_NAME = "bookmark-manager";
const DB_VERSION = 1;
const STORE = "state";
const KEY = "current";

export interface MirrorState {
  file: BookmarkFile;
  /** Blob sha from the last successful read or write. */
  sha: string | null;
  etag: string | null;
  /** True when the mirror holds changes not yet committed to GitHub. */
  dirty: boolean;
  /** How many local edits are waiting, for the UI. */
  pending: number;
  savedAt: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

/** Persist the local state. Resolves false if storage is unavailable — never throws. */
export async function saveMirror(state: MirrorState): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      // Structured clone cannot carry Svelte's reactive proxies, so the state is round-tripped
      // through JSON first. Cheap at this scale (§1.1) and avoids a DataCloneError.
      tx.objectStore(STORE).put(JSON.parse(JSON.stringify(state)), KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/** Read the local state, or null if there is none or storage is unavailable. */
export async function loadMirror(): Promise<MirrorState | null> {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve((request.result as MirrorState) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function clearMirror(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
  } catch {
    /* nothing useful to do */
  }
}

/** Test seam — drops the cached connection so a fresh database can be opened. */
export function resetDbForTests(): void {
  dbPromise = null;
}
