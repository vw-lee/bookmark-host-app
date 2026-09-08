/**
 * Sync state, reduced to one legible signal (task 7n).
 *
 * The header used to carry four independent phrases — "Syncing…", "3 queued", "Offline",
 * "Synced" — chosen by a chain of `{#if}` in the markup. That had two problems. The chain was
 * untestable without mounting the whole app, and it was incomplete: an expired token, a file
 * past the 1 MB ceiling, or a collection that had never connected all rendered as the same
 * blank space, because none of them matched a branch.
 *
 * So the decision moves here, as a pure function over a snapshot. Every state the app can be
 * in maps to exactly one of three glyphs — tick, wait, cross — plus a tone that reinforces it.
 *
 * ## Why the glyph, not the colour, carries the meaning
 *
 * §1.2 forbids signalling by colour alone: the e-ink theme flattens every colour to black, and
 * a status that reads as "green vs red" there reads as "black vs black". The glyph and the
 * label survive that flattening. Colour is reinforcement for the other themes, and for the
 * common case of a glance from across the desk.
 */
import type { PersistenceState, SizeReport } from "../sync/persistence";

/** Three shapes, distinguishable at a glance and without colour vision. */
export type SyncIcon = "tick" | "wait" | "cross";

/** Reinforcement only — never the sole carrier of meaning (§1.2). */
export type SyncTone = "ok" | "busy" | "warn" | "bad";

/**
 * Everything the badge reads, flattened.
 *
 * A plain object rather than the store itself, so the ranking below can be tested against
 * a dozen states without a GitHub client, a mount, or a fake clock.
 */
export interface SyncSnapshot {
  connected: boolean;
  syncing: boolean;
  offline: boolean;
  pendingCount: number;
  /** Epoch ms the rate-limit park expires, or null. */
  parkedUntil: number | null;
  lastSyncedAt: string | null;
  tokenExpired: boolean;
  hasError: boolean;
  size: SizeReport;
  persistence: PersistenceState;
  now: number;
}

export type SyncKind =
  | "expired"
  | "full"
  | "error"
  | "offline"
  | "local"
  | "parked"
  | "syncing"
  | "queued"
  | "synced"
  | "idle";

export interface SyncStatus {
  kind: SyncKind;
  icon: SyncIcon;
  tone: SyncTone;
  /** Two or three words, sized for the header. */
  label: string;
  /** One sentence: what is happening, and whether anything is at risk. */
  summary: string;
}

/** Seconds left on a rate-limit park, floored at zero. */
export function parkedSeconds(parkedUntil: number | null, now: number): number {
  if (parkedUntil === null) return 0;
  return Math.max(0, Math.ceil((parkedUntil - now) / 1000));
}

/**
 * Rank a snapshot into a single status.
 *
 * The order is "what most needs the user to know", not "what changed most recently". States
 * needing action come first, then states that resolve on their own, then rest.
 *
 * Red (`bad`) is reserved for states that need the user to do something. Offline and a parked
 * rate limit are amber: they are conditions to wait out, and a red cross for going through a
 * tunnel trains people to ignore the indicator by the time it means something.
 */
export function describeSync(s: SyncSnapshot): SyncStatus {
  const queued = s.pendingCount > 0;
  // Phrased once — every branch that mentions the queue says it the same way.
  const queuedPhrase = `${s.pendingCount} change${s.pendingCount === 1 ? "" : "s"} saved on this device and waiting to sync`;

  // 1. A dead token stops every sync until a new one is pasted. Nothing outranks it.
  if (s.tokenExpired) {
    return {
      kind: "expired",
      icon: "cross",
      tone: "bad",
      label: "Sign in",
      summary: `GitHub rejected the saved token, so nothing is syncing.${queued ? ` ${queuedPhrase}.` : ""}`,
    };
  }

  // 2. Past the 1 MB ceiling the Contents API cannot return the file, so writes are unsafe
  //    (§4.3). Ranked above offline because reconnecting will not fix it.
  if (s.size.level === "critical") {
    return {
      kind: "full",
      icon: "cross",
      tone: "bad",
      label: "File full",
      summary:
        "The bookmarks file has passed the 1 MB limit the GitHub Contents API can return, so it cannot safely be written.",
    };
  }

  // 3. Any other error the sync loop surfaced.
  if (s.hasError) {
    return {
      kind: "error",
      icon: "cross",
      tone: "bad",
      label: "Sync failed",
      summary: `The last sync did not complete.${queued ? ` ${queuedPhrase}.` : ""}`,
    };
  }

  // 4. Offline — a state to wait out, so amber rather than red. Still a cross: syncing is
  //    genuinely not happening, and a tick here would be a lie.
  if (s.offline) {
    return {
      kind: "offline",
      icon: "cross",
      tone: "warn",
      label: "Offline",
      summary: queued
        ? `Offline. ${queuedPhrase}.`
        : "Offline. Changes are saved here and will sync when you reconnect.",
    };
  }

  // 5. Never connected, or disconnected on purpose. The old header showed nothing at all here,
  //    which read as "synced" to anyone not looking closely.
  if (!s.connected) {
    return {
      kind: "local",
      icon: "cross",
      tone: "warn",
      label: "Local only",
      summary:
        "Not connected to GitHub. Everything is saved on this device only, so nothing is backed up.",
    };
  }

  // 6. Parked on a rate limit — the queue resumes by itself, so this is a wait, not a failure.
  const parked = parkedSeconds(s.parkedUntil, s.now);
  if (parked > 0) {
    return {
      kind: "parked",
      icon: "wait",
      tone: "warn",
      label: `Paused ${parked}s`,
      summary: `GitHub's rate limit was reached. Syncing resumes in ${parked}s — nothing is lost.`,
    };
  }

  if (s.syncing) {
    return {
      kind: "syncing",
      icon: "wait",
      tone: "busy",
      label: "Syncing…",
      summary: "Sending your changes to GitHub.",
    };
  }

  // 7. Queued but online and idle: the 3s write debounce (§4.4) is still counting down.
  if (queued) {
    return {
      kind: "queued",
      icon: "wait",
      tone: "busy",
      label: `${s.pendingCount} queued`,
      summary: `${queuedPhrase}.`,
    };
  }

  if (s.lastSyncedAt) {
    return {
      kind: "synced",
      icon: "tick",
      tone: "ok",
      label: "Synced",
      summary: "Everything on this device is saved to GitHub.",
    };
  }

  // 8. Connected, nothing queued, nothing sent yet — the state right after opening the app.
  return {
    kind: "idle",
    icon: "tick",
    tone: "ok",
    label: "Up to date",
    summary: "Connected to GitHub. Nothing has changed since this collection was loaded.",
  };
}

/**
 * "2 minutes ago", for the popover's last-synced line.
 *
 * Deliberately coarse. A sync time to the second invites reading the indicator as a live
 * clock, when the only question it answers is "recently, or worryingly long ago".
 */
export function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "never";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "never";

  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  if (days <= 30) return `${days} day${days === 1 ? "" : "s"} ago`;

  // Past a month, the date itself is more use than a count of days.
  return new Date(then).toLocaleDateString();
}
