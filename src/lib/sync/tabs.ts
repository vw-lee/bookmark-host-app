/**
 * Multi-tab coordination (task 3e).
 *
 * Two tabs writing at once is how a collection gets corrupted: both hold the same blob sha,
 * both PUT, and the second either 409s or — worse, if it retried naively — overwrites the
 * first. The Web Locks API serialises writes across every tab on the origin; BroadcastChannel
 * then tells the other tabs what happened so they do not sit on stale state.
 *
 * Both APIs degrade gracefully. Without Web Locks the callback still runs (single-tab
 * behaviour, which is the common case); without BroadcastChannel tabs simply refresh on focus.
 */
import type { BookmarkFile } from "../schema/types";

const WRITE_LOCK = "bookmark-manager:write";
const CHANNEL = "bookmark-manager";

export type TabMessage =
  | { type: "committed"; file: BookmarkFile; sha: string }
  | { type: "disconnected" };

/**
 * Run `fn` while holding the cross-tab write lock.
 *
 * `ifAvailable` is deliberately NOT used: a second tab's write must wait for the first, not be
 * silently dropped. The lock is released when the promise settles.
 */
export async function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) return fn();
  return navigator.locks.request(WRITE_LOCK, fn) as Promise<T>;
}

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL);
    } catch {
      return null;
    }
  }
  return channel;
}

/** Tell other tabs that this one committed, so they can adopt the new state without a fetch. */
export function announce(message: TabMessage): void {
  try {
    getChannel()?.postMessage(message);
  } catch {
    /* a failed announcement only costs the other tabs a refresh on focus */
  }
}

/** Subscribe to other tabs' announcements. Returns an unsubscribe function. */
export function onTabMessage(handler: (message: TabMessage) => void): () => void {
  const c = getChannel();
  if (!c) return () => {};
  const listener = (event: MessageEvent) => handler(event.data as TabMessage);
  c.addEventListener("message", listener);
  return () => c.removeEventListener("message", listener);
}

export function closeChannel(): void {
  try {
    channel?.close();
  } catch {
    /* nothing useful to do */
  }
  channel = null;
}
