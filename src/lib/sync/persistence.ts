/**
 * Storage persistence and the size tripwire (tasks 3i, 3g).
 *
 * Android evicts IndexedDB under storage pressure, and the outbox lives there. Eviction with
 * unsynced bookmarks queued is silent data loss (§6.3), so the grant state is requested and
 * then surfaced rather than assumed.
 */

export type PersistenceState = "granted" | "denied" | "unsupported";

/**
 * Ask the browser to make our storage persistent.
 *
 * Chrome weighs installation heavily, so this generally succeeds for an installed PWA and
 * generally fails in a plain tab — which is exactly why the result has to be shown to the user
 * instead of being fire-and-forget.
 */
export async function requestPersistence(): Promise<PersistenceState> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return "unsupported";
  try {
    if (await navigator.storage.persisted()) return "granted";
    return (await navigator.storage.persist()) ? "granted" : "denied";
  } catch {
    return "unsupported";
  }
}

/** Current grant state without requesting it. */
export async function persistenceState(): Promise<PersistenceState> {
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) return "unsupported";
  try {
    return (await navigator.storage.persisted()) ? "granted" : "denied";
  } catch {
    return "unsupported";
  }
}

/**
 * Task 3g. At the target scale (§1.1) this should never fire — roughly 500 bookmarks is
 * ~300 KB against a 1 MB ceiling. It exists so the ceiling cannot arrive unannounced.
 */
export const SIZE_WARN_BYTES = 700_000;
export const SIZE_CEILING_BYTES = 1_000_000;

export interface SizeReport {
  bytes: number;
  /** Fraction of the 1 MB Contents API ceiling. */
  ratio: number;
  level: "ok" | "warn" | "critical";
}

export function measureSize(serialized: string): SizeReport {
  // The API limit applies to the file on disk, so measure encoded bytes, not code units.
  const bytes = new TextEncoder().encode(serialized).length;
  return {
    bytes,
    ratio: bytes / SIZE_CEILING_BYTES,
    level: bytes >= SIZE_CEILING_BYTES ? "critical" : bytes >= SIZE_WARN_BYTES ? "warn" : "ok",
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
