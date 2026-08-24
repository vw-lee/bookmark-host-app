/**
 * Application state and the sync engine's foreground half (README §1).
 *
 * Svelte 5 runes hold the reactive state; everything that touches GitHub goes through the
 * client in api/github.ts. Phase 3 will add the IndexedDB mirror and the durable outbox behind
 * this same surface — the UI should not need to change when it does.
 */
import { GitHubClient, NOT_MODIFIED } from "./api/github";
import { GitHubError } from "./api/errors";
import {
  loadConnection,
  saveConnection,
  saveWrappedConnection,
  unlockConnection,
  hasWrappedToken,
  clearToken,
  type Connection,
  type StorageMode,
} from "./api/tokenStore";
import { parseBookmarkFile } from "./schema/schema";
import { migrate, needsMigration } from "./schema/migrate";
import { serialize } from "./schema/serialize";
import { emptyFile, SCHEMA_VERSION, type Bookmark, type BookmarkFile } from "./schema/types";
import { normalizeTags, normalizeUrlKey, cleanText, tagMatches } from "./schema/normalize";
import { ulid } from "./schema/ulid";
import { merge, liveBookmarks } from "./sync/merge";
import { toBookmarks, type MergePlan } from "./io/netscape";
import {
  findDuplicates,
  applyDedupe,
  applyRename,
  applyDeleteTag,
  type DuplicateGroup,
} from "./io/bulk";
import { saveMirror, loadMirror, clearMirror, type MirrorState } from "./sync/db";
import { withWriteLock, announce, onTabMessage } from "./sync/tabs";
import {
  measureSize,
  requestPersistence,
  persistenceState,
  type PersistenceState,
  type SizeReport,
} from "./sync/persistence";

export type Status = "disconnected" | "loading" | "ready" | "error";

/** Field caps, applied on every write path (§5.4). */
const MAX_TITLE = 500;
const MAX_DESCRIPTION = 2000;
const MAX_NOTES = 10_000;
const MAX_URL = 2048;

/** Coalesce a burst of edits into one commit (§4.4). */
const WRITE_DEBOUNCE_MS = 3000;

/** Foreground refresh interval (task 3k). Conditional, so an unchanged file costs no quota. */
export const REFRESH_INTERVALS = [0, 60_000, 300_000, 900_000] as const;
const DEFAULT_REFRESH_MS = 300_000;

export class AppStore {
  status = $state<Status>("disconnected");
  error = $state<GitHubError | Error | null>(null);
  file = $state<BookmarkFile>(emptyFile());
  syncing = $state(false);
  pendingCount = $state(0);
  lastSyncedAt = $state<string | null>(null);

  query = $state("");
  selectedTag = $state<string | null>(null);
  showArchived = $state(false);

  /**
   * Pagination (task 7c) — not virtual scrolling. Under 500 bookmarks virtualisation buys
   * nothing (§1.1), and continuous scroll causes ghosting on e-ink (§1.2).
   */
  page = $state(0);
  pageSize = $state(50);

  /** True when the browser reports no connection, or a write failed on the network (3d). */
  offline = $state(typeof navigator !== "undefined" ? !navigator.onLine : false);
  /** Set while the queue is parked on a rate limit; epoch ms (task 2d). */
  parkedUntil = $state<number | null>(null);
  persistence = $state<PersistenceState>("unsupported");
  size = $state<SizeReport>({ bytes: 0, ratio: 0, level: "ok" });
  refreshMs = $state<number>(DEFAULT_REFRESH_MS);
  /** Set when another device committed and we adopted it, so the UI can say so. */
  remoteChangedAt = $state<string | null>(null);

  /** True until restore() settles, so the shell does not flash the setup form on startup. */
  booting = $state(true);
  /** Set when the user explicitly asks to (re)connect, overriding the cached-data case. */
  wantsSetup = $state(false);
  /** A PIN-wrapped token is stored and waiting to be unlocked (D13). */
  locked = $state(false);

  private client: GitHubClient | null = null;
  private sha: string | null = null;
  private etag: string | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private writing = false;
  private dirty = false;
  private teardown: (() => void)[] = [];

  /** Live, non-archived records matching the current search and tag filter. */
  get visible(): Bookmark[] {
    const q = this.query.trim().toLowerCase();
    const tag = this.selectedTag;

    return liveBookmarks(this.file)
      .filter((b) => (this.showArchived ? true : !b.archived))
      .filter((b) => (tag ? b.tags.some((t) => tagMatches(t, tag)) : true))
      .filter((b) => {
        if (!q) return true;
        return (
          b.title.toLowerCase().includes(q) ||
          b.url.toLowerCase().includes(q) ||
          b.description.toLowerCase().includes(q) ||
          b.tags.some((t) => t.includes(q))
        );
      })
      .sort((a, b) => {
        // Pinned first, then newest by creation. ULIDs sort by time, so id works as the key.
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return a.id < b.id ? 1 : -1;
      });
  }

  /** The current page of `visible`. */
  get pageItems(): Bookmark[] {
    const start = this.page * this.pageSize;
    return this.visible.slice(start, start + this.pageSize);
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.visible.length / this.pageSize));
  }

  /** Clamp the page after a filter change shrinks the result set. */
  clampPage(): void {
    if (this.page >= this.pageCount) this.page = this.pageCount - 1;
    if (this.page < 0) this.page = 0;
  }

  /** Every tag in use, with its descendant-inclusive count (§3.3.2). */
  get tagCounts(): Map<string, { exact: number; total: number }> {
    const counts = new Map<string, { exact: number; total: number }>();
    const live = liveBookmarks(this.file).filter((b) => this.showArchived || !b.archived);

    for (const b of live) {
      for (const tag of b.tags) {
        const parts = tag.split("/");
        for (let i = 1; i <= parts.length; i++) {
          const node = parts.slice(0, i).join("/");
          const entry = counts.get(node) ?? { exact: 0, total: 0 };
          entry.total += 1;
          if (i === parts.length) entry.exact += 1;
          counts.set(node, entry);
        }
      }
    }
    return counts;
  }

  get connected(): boolean {
    return this.client !== null;
  }

  /**
   * Should the shell show the first-run form?
   *
   * Deliberately keyed on `connected` rather than on `status`. `status` becomes "loading" the
   * moment a connection attempt starts, and keying on it unmounted the form mid-submit —
   * destroying the typed token and the error message it was about to show, so a failed connect
   * looked like nothing happening at all.
   *
   * A cached collection with no working token still renders read-only; the user reaches this
   * form through the reconnect banner instead.
   */
  get needsSetup(): boolean {
    if (this.wantsSetup) return true;
    // A locked token means setup is already done; the unlock screen owns the flow instead.
    if (this.locked) return false;
    return !this.connected && liveBookmarks(this.file).length === 0;
  }

  /**
   * Startup (tasks 3b, 3c, 3d).
   *
   * The mirror is adopted BEFORE the network is touched, so the app renders from cache in one
   * frame and syncs behind. If the last session left unsynced edits, they are still here — that
   * is the whole point of persisting `dirty`.
   */
  async restore(): Promise<void> {
    try {
      await this.restoreInner();
    } finally {
      this.booting = false;
    }
  }

  private async restoreInner(): Promise<void> {
    this.installListeners();
    void persistenceState().then((state) => (this.persistence = state));

    const mirror = await loadMirror();
    if (mirror) {
      this.file = mirror.file;
      this.sha = mirror.sha;
      this.etag = mirror.etag;
      this.dirty = mirror.dirty;
      this.pendingCount = mirror.pending;
      this.size = measureSize(serialize(mirror.file));
      if (mirror.dirty) this.status = "ready";
    }

    if (hasWrappedToken()) {
      this.locked = true;
      this.status = mirror ? "ready" : "disconnected";
      return;
    }

    const connection = loadConnection();
    if (!connection) {
      // A cached collection with no token is still worth showing read-only rather than
      // throwing the user back to a blank setup screen.
      this.status = mirror ? "ready" : "disconnected";
      return;
    }

    try {
      await this.connect(connection, null);
    } catch {
      // Offline or expired token — the mirror already rendered, so this is not fatal.
      if (mirror) this.status = "ready";
    }
  }

  /** Window and cross-tab listeners. Registered once; torn down on disconnect. */
  private installListeners(): void {
    if (this.teardown.length > 0) return;

    if (typeof window !== "undefined") {
      const online = () => {
        this.offline = false;
        // Reconnecting is the moment queued work should go out (3d).
        if (this.dirty) void this.flush();
      };
      const offline = () => (this.offline = true);
      window.addEventListener("online", online);
      window.addEventListener("offline", offline);
      this.teardown.push(() => {
        window.removeEventListener("online", online);
        window.removeEventListener("offline", offline);
      });
    }

    // Another tab committed: adopt its state rather than racing it (3e).
    this.teardown.push(
      onTabMessage((message) => {
        if (message.type !== "committed") return;
        this.file = merge(this.file, message.file);
        this.sha = message.sha;
        this.etag = null;
        this.remoteChangedAt = new Date().toISOString();
        void this.persistMirror();
      }),
    );

    this.startRefreshTimer();
  }

  /**
   * Foreground refresh poll (task 3k).
   *
   * Runs only while the document is visible and stops when hidden. Every request is
   * ETag-conditional, so an unchanged file returns 304 and costs no rate-limit quota — which is
   * what makes a five-minute cadence essentially free.
   */
  private startRefreshTimer(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.refreshMs <= 0) return;

    this.refreshTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (!this.client || this.offline || this.writing || this.isParked()) return;
      void this.load({ quiet: true });
    }, this.refreshMs);

    this.teardown.push(() => {
      if (this.refreshTimer) clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    });
  }

  setRefreshInterval(ms: number): void {
    this.refreshMs = ms;
    this.startRefreshTimer();
  }

  /** Refresh on focus regain (task 3f). Cheap for the same reason 3k is. */
  refreshOnFocus(): void {
    if (!this.client || this.offline || this.writing) return;
    void this.load({ quiet: true });
  }

  /** Ask for persistent storage; called after install (task 3i, 5h). */
  async ensurePersistence(): Promise<PersistenceState> {
    this.persistence = await requestPersistence();
    return this.persistence;
  }

  /** True while the write queue is parked on a rate limit (task 2d). */
  isParked(): boolean {
    if (this.parkedUntil === null) return false;
    if (Date.now() >= this.parkedUntil) {
      this.parkedUntil = null;
      return false;
    }
    return true;
  }

  /** Write the mirror. Never throws — losing the mirror must not break the app. */
  private async persistMirror(): Promise<void> {
    const serialized = serialize(this.file);
    this.size = measureSize(serialized);
    const state: MirrorState = {
      file: this.file,
      sha: this.sha,
      etag: this.etag,
      dirty: this.dirty,
      pending: this.pendingCount,
      savedAt: new Date().toISOString(),
    };
    await saveMirror(state);
  }

  /**
   * Connect, probe, and load. `mode` null means "already saved, do not re-persist".
   * Task 1a/1c/1d: probe, read, and bootstrap the file if it does not exist.
   */
  /**
   * Unlock a PIN-wrapped token and connect with it (D13).
   * Returns false for a wrong passphrase, without disturbing any state.
   */
  async unlock(pin: string): Promise<boolean> {
    const connection = await unlockConnection(pin);
    if (!connection) return false;
    this.locked = false;
    await this.connect(connection, null);
    return true;
  }

  /** Wrap and store the current connection under a passphrase. */
  async setPin(connection: Connection, pin: string): Promise<void> {
    await saveWrappedConnection(connection, pin);
  }

  async connect(
    connection: Connection,
    mode: StorageMode | null,
    /** Injected only by tests, so the store can be driven against a scripted API. */
    fetchImpl?: typeof fetch,
  ): Promise<void> {
    this.status = "loading";
    this.error = null;

    const client = new GitHubClient(
      connection.token,
      { owner: connection.owner, repo: connection.repo, path: connection.path },
      fetchImpl,
    );

    try {
      await client.probe();
      this.client = client;
      this.wantsSetup = false;
      this.locked = false;
      // "pin" is persisted by setPin(), which needs the passphrase this method does not have.
      if (mode && mode !== "pin") saveConnection(connection, mode);
      await this.load();
    } catch (e) {
      this.client = null;
      this.error = e as Error;
      this.status = "error";
      // Rethrown so the setup form — which is still mounted — can show the reason inline.
      throw e;
    }
  }

  /**
   * Read and validate the remote file, bootstrapping it on first run (task 1d).
   *
   * `quiet` is used by the background refresh (3k/3f): a poll that fails must not blank the
   * screen or replace a working view with an error banner.
   */
  async load(options: { quiet?: boolean } = {}): Promise<void> {
    if (!this.client) return;
    this.syncing = true;
    try {
      const result = await this.client.read(this.etag);
      if (result === NOT_MODIFIED) {
        this.status = "ready";
        return;
      }

      const raw = result.text.trim() === "" ? emptyFile() : JSON.parse(result.text);
      const migrated = migrate(raw);
      const remoteFile = parseBookmarkFile(migrated);

      // Local edits that have not been committed must survive a refresh. Merging rather than
      // replacing is what makes the background poll safe to run while the outbox is dirty.
      const changed = this.dirty
        ? (this.file = merge(this.file, remoteFile))
        : (this.file = remoteFile);
      void changed;

      if (options.quiet && result.sha !== this.sha) {
        this.remoteChangedAt = new Date().toISOString();
      }

      this.sha = result.sha;
      this.etag = result.etag;
      this.status = "ready";
      this.lastSyncedAt = new Date().toISOString();
      if (!options.quiet) this.error = null;

      // A file written by an older build is rewritten once, so the migration cost is paid
      // exactly once rather than on every load.
      if (needsMigration(raw)) this.scheduleFlush();
      await this.persistMirror();
    } catch (e) {
      if (e instanceof GitHubError && e.kind === "file-missing") {
        await this.bootstrap();
        return;
      }
      if (e instanceof GitHubError && e.kind === "network") this.offline = true;
      // A failed background poll leaves the working view alone.
      if (!options.quiet) {
        this.error = e as Error;
        this.status = "error";
      }
    } finally {
      this.syncing = false;
    }
  }

  /** Create the bookmarks file on first run. */
  private async bootstrap(): Promise<void> {
    if (!this.client) return;
    this.file = emptyFile();
    const { sha } = await this.client.write(
      serialize(this.file),
      "chore: initialise bookmarks.json",
    );
    this.sha = sha;
    this.etag = null;
    this.status = "ready";
    this.lastSyncedAt = new Date().toISOString();
    await this.persistMirror();
  }

  // ---------------------------------------------------------------- mutations

  /**
   * Add a bookmark, or update the existing one with the same urlKey (task 2g).
   * Returns the record that ended up in the store.
   */
  addBookmark(input: {
    url: string;
    title?: string;
    description?: string;
    tags?: string[];
  }): Bookmark | null {
    const url = cleanText(input.url, MAX_URL);
    const urlKey = normalizeUrlKey(url);
    if (!urlKey) return null; // unsafe or unparseable — the caller surfaces this

    const now = new Date().toISOString();
    const tags = normalizeTags(input.tags ?? []);
    const title = cleanText(input.title ?? "", MAX_TITLE) || new URL(url).hostname;
    const description = cleanText(input.description ?? "", MAX_DESCRIPTION);

    const existing = this.file.bookmarks.find((b) => b.urlKey === urlKey && !b.deletedAt);
    if (existing) {
      // Dedupe: update in place rather than creating a second record for the same link.
      this.updateBookmark(existing.id, {
        title: title || existing.title,
        description: description || existing.description,
        tags: normalizeTags([...existing.tags, ...tags]),
      });
      return this.file.bookmarks.find((b) => b.id === existing.id) ?? null;
    }

    const record: Bookmark = {
      id: ulid(),
      url,
      urlKey,
      title,
      description,
      notes: "",
      tags,
      favicon: null,
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      enrichedAt: null,
    };

    this.file = { ...this.file, bookmarks: [...this.file.bookmarks, record], updatedAt: now };
    this.scheduleFlush();
    return record;
  }

  updateBookmark(id: string, patch: Partial<Omit<Bookmark, "id" | "createdAt">>): void {
    const now = new Date().toISOString();
    const clean: Partial<Bookmark> = { ...patch };
    if (patch.title !== undefined) clean.title = cleanText(patch.title, MAX_TITLE);
    if (patch.description !== undefined)
      clean.description = cleanText(patch.description, MAX_DESCRIPTION);
    if (patch.notes !== undefined) clean.notes = cleanText(patch.notes, MAX_NOTES);
    if (patch.tags !== undefined) clean.tags = normalizeTags(patch.tags);
    if (patch.url !== undefined) {
      const url = cleanText(patch.url, MAX_URL);
      const key = normalizeUrlKey(url);
      if (!key) return; // refuse to store an unsafe URL (§5.4)
      clean.url = url;
      clean.urlKey = key;
    }

    this.file = {
      ...this.file,
      updatedAt: now,
      bookmarks: this.file.bookmarks.map((b) =>
        b.id === id ? { ...b, ...clean, updatedAt: now } : b,
      ),
    };
    this.scheduleFlush();
  }

  /** Delete writes a tombstone; the record is retained so the deletion survives a merge. */
  deleteBookmark(id: string): void {
    const now = new Date().toISOString();
    this.file = {
      ...this.file,
      updatedAt: now,
      bookmarks: this.file.bookmarks.map((b) =>
        b.id === id ? { ...b, deletedAt: now, updatedAt: now } : b,
      ),
    };
    this.scheduleFlush();
  }

  // ------------------------------------------------------------------ import

  /**
   * Apply an import plan (task 4b/4h). The plan is built and previewed first; this only
   * commits what the user already saw.
   *
   * Incoming tags are merged into an existing record rather than replacing them — an import
   * should never silently drop categorisation the user has already done.
   */
  applyImport(plan: MergePlan): { added: number; updated: number } {
    const now = new Date().toISOString();
    const additions = toBookmarks(plan.additions);

    const updatedIds = new Map(plan.updates.map((u) => [u.existingId, u.incoming]));
    const existing = this.file.bookmarks.map((b) => {
      const incoming = updatedIds.get(b.id);
      if (!incoming) return b;
      return {
        ...b,
        title: b.title || incoming.title,
        description: b.description || incoming.description,
        tags: normalizeTags([...b.tags, ...incoming.tags]),
        updatedAt: now,
      };
    });

    this.file = {
      ...this.file,
      updatedAt: now,
      bookmarks: [...existing, ...additions],
    };
    this.scheduleFlush();
    return { added: additions.length, updated: plan.updates.length };
  }

  // -------------------------------------------------------------- bulk edits

  /** Live duplicate groups sharing a urlKey (task 4e). */
  get duplicates(): DuplicateGroup[] {
    return findDuplicates(this.file.bookmarks);
  }

  /** Merge the given duplicate groups. Returns how many records were tombstoned. */
  mergeDuplicates(groups: DuplicateGroup[]): number {
    if (groups.length === 0) return 0;
    const now = new Date().toISOString();
    this.file = {
      ...this.file,
      updatedAt: now,
      bookmarks: applyDedupe(this.file.bookmarks, groups, now),
    };
    this.scheduleFlush();
    return groups.reduce((total, g) => total + g.merge.length, 0);
  }

  /** Rename a tag and its whole subtree (task 4f). */
  renameTag(from: string, to: string): void {
    const now = new Date().toISOString();
    const bookmarks = applyRename(this.file.bookmarks, from, to, now);
    if (bookmarks === this.file.bookmarks) return;
    this.file = { ...this.file, updatedAt: now, bookmarks };
    // A selected tag that no longer exists would silently show an empty list.
    if (this.selectedTag && this.selectedTag.startsWith(from)) this.selectedTag = null;
    this.scheduleFlush();
  }

  /** Remove a tag and its descendants from every record. Bookmarks are never deleted. */
  deleteTag(tag: string): void {
    const now = new Date().toISOString();
    const bookmarks = applyDeleteTag(this.file.bookmarks, tag, now);
    if (bookmarks === this.file.bookmarks) return;
    this.file = { ...this.file, updatedAt: now, bookmarks };
    if (this.selectedTag && this.selectedTag.startsWith(tag)) this.selectedTag = null;
    this.scheduleFlush();
  }

  // ------------------------------------------------------------------- writes

  /**
   * Debounced flush — a burst of edits becomes one commit (§4.4).
   *
   * The mirror is written IMMEDIATELY, before the debounce; durability must not wait three
   * seconds. Only the network write is debounced.
   */
  private scheduleFlush(): void {
    this.dirty = true;
    this.pendingCount += 1;
    void this.persistMirror();

    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), WRITE_DEBOUNCE_MS);
  }

  /**
   * Commit pending changes. Single in-flight by construction (§4.4): a call while a write is
   * running marks the state dirty and returns, and the running write re-runs afterwards.
   */
  async flush(): Promise<void> {
    if (!this.client || !this.dirty) return;
    if (this.writing) return;
    // Parked on a rate limit (task 2d) or offline (3d): the mirror already holds the changes,
    // so there is nothing to lose by waiting.
    if (this.isParked() || this.offline) return;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    this.writing = true;
    this.syncing = true;
    const attemptedCount = this.pendingCount;

    try {
      // Cross-tab lock (3e): two tabs holding the same sha must not both PUT.
      await withWriteLock(async () => {
        this.dirty = false;
        const message =
          attemptedCount === 1 ? "feat: update bookmarks" : `chore: sync ${attemptedCount} changes`;
        const { sha } = await this.client!.write(
          serialize(this.file),
          message,
          this.sha ?? undefined,
        );
        this.sha = sha;
        this.etag = null; // the etag we hold is now stale by definition
        this.pendingCount = Math.max(0, this.pendingCount - attemptedCount);
        this.lastSyncedAt = new Date().toISOString();
        this.error = null;
        announce({ type: "committed", file: this.file, sha });
      });
    } catch (e) {
      this.dirty = true; // nothing was committed; keep the changes queued
      if (e instanceof GitHubError && e.kind === "conflict") {
        await this.resolveConflict();
      } else if (e instanceof GitHubError && e.kind === "rate-limit") {
        // Park rather than hammer. retryAt comes from Retry-After or x-ratelimit-reset (§4.5).
        this.parkedUntil = e.retryAt ?? Date.now() + 60_000;
        this.error = e;
        this.scheduleUnpark();
      } else if (e instanceof GitHubError && e.kind === "network") {
        this.offline = true;
        this.error = null; // offline is a state, not an error the user must act on
      } else {
        this.error = e as Error;
        if (e instanceof GitHubError && e.kind === "auth") clearToken();
      }
    } finally {
      this.writing = false;
      this.syncing = false;
      await this.persistMirror();
      // A change that arrived mid-write still needs committing.
      if (this.dirty && !this.error && !this.offline && !this.isParked()) this.scheduleFlush();
    }
  }

  /** Resume the queue when the rate-limit window closes (task 2d). */
  private scheduleUnpark(): void {
    if (this.parkedUntil === null) return;
    const delay = Math.max(1000, this.parkedUntil - Date.now());
    setTimeout(() => {
      this.parkedUntil = null;
      this.error = null;
      if (this.dirty) void this.flush();
    }, delay);
  }

  /**
   * 409 path (task 3a): refetch, merge, retry. Bounded at three attempts, after which the
   * error surfaces rather than looping.
   */
  private async resolveConflict(attempt = 1): Promise<void> {
    if (!this.client || attempt > 3) {
      this.error = new Error("Could not merge with the version on GitHub after three attempts.");
      return;
    }

    try {
      const remote = await this.client.read(null);
      if (remote === NOT_MODIFIED) return;

      const remoteFile = parseBookmarkFile(migrate(JSON.parse(remote.text)));
      this.file = merge(this.file, remoteFile);
      this.sha = remote.sha;
      this.etag = remote.etag;

      const { sha } = await this.client.write(
        serialize(this.file),
        "chore: merge remote bookmark changes",
        this.sha,
      );
      this.sha = sha;
      this.etag = null;
      this.dirty = false;
      this.pendingCount = 0;
      this.lastSyncedAt = new Date().toISOString();
      this.remoteChangedAt = new Date().toISOString();
      this.error = null;
      announce({ type: "committed", file: this.file, sha });
      await this.persistMirror();
    } catch (e) {
      if (e instanceof GitHubError && e.kind === "conflict") {
        await this.resolveConflict(attempt + 1);
      } else {
        this.error = e as Error;
      }
    }
  }

  /** Flush immediately — used on page hide, where the debounce would never fire (§4.4). */
  flushNow(): void {
    if (this.dirty) void this.flush();
  }

  disconnect(): void {
    this.client = null;
    this.sha = null;
    this.etag = null;
    this.file = emptyFile();
    this.status = "disconnected";
    this.error = null;
    this.wantsSetup = true;
    this.locked = false;
    this.dirty = false;
    this.pendingCount = 0;
    for (const off of this.teardown) off();
    this.teardown = [];
    void clearMirror();
    announce({ type: "disconnected" });
  }
}

export const store = new AppStore();
export { SCHEMA_VERSION };
