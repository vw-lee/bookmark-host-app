/**
 * Application state and the sync engine's foreground half (README §1).
 *
 * Svelte 5 runes hold the reactive state; everything that touches GitHub goes through the
 * client in api/github.ts. Phase 3 will add the IndexedDB mirror and the durable outbox behind
 * this same surface — the UI should not need to change when it does.
 */
import { GitHubClient, NOT_MODIFIED } from "./api/github";
import { GitHubError } from "./api/errors";
import { loadConnection, saveConnection, clearToken, type Connection } from "./api/tokenStore";
import { parseBookmarkFile } from "./schema/schema";
import { migrate, needsMigration } from "./schema/migrate";
import { serialize } from "./schema/serialize";
import { emptyFile, SCHEMA_VERSION, type Bookmark, type BookmarkFile } from "./schema/types";
import { normalizeTags, normalizeUrlKey, cleanText, tagMatches } from "./schema/normalize";
import { ulid } from "./schema/ulid";
import { merge, liveBookmarks } from "./sync/merge";

export type Status = "disconnected" | "loading" | "ready" | "error";

/** Field caps, applied on every write path (§5.4). */
const MAX_TITLE = 500;
const MAX_DESCRIPTION = 2000;
const MAX_NOTES = 10_000;
const MAX_URL = 2048;

/** Coalesce a burst of edits into one commit (§4.4). */
const WRITE_DEBOUNCE_MS = 3000;

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

  private client: GitHubClient | null = null;
  private sha: string | null = null;
  private etag: string | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private writing = false;
  private dirty = false;

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

  /** Try to restore a saved connection on startup. */
  async restore(): Promise<void> {
    const connection = loadConnection();
    if (!connection) {
      this.status = "disconnected";
      return;
    }
    await this.connect(connection, null);
  }

  /**
   * Connect, probe, and load. `mode` null means "already saved, do not re-persist".
   * Task 1a/1c/1d: probe, read, and bootstrap the file if it does not exist.
   */
  async connect(
    connection: Connection,
    mode: "session" | "local" | null,
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
      if (mode) saveConnection(connection, mode);
      await this.load();
    } catch (e) {
      this.client = null;
      this.error = e as Error;
      this.status = "error";
      throw e;
    }
  }

  /** Read and validate the remote file, bootstrapping it on first run (task 1d). */
  async load(): Promise<void> {
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
      this.file = parseBookmarkFile(migrated);
      this.sha = result.sha;
      this.etag = result.etag;
      this.status = "ready";
      this.lastSyncedAt = new Date().toISOString();

      // A file written by an older build is rewritten once, so the migration cost is paid
      // exactly once rather than on every load.
      if (needsMigration(raw)) this.scheduleFlush();
    } catch (e) {
      if (e instanceof GitHubError && e.kind === "file-missing") {
        await this.bootstrap();
        return;
      }
      this.error = e as Error;
      this.status = "error";
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

  // ------------------------------------------------------------------- writes

  /** Debounced flush — a burst of edits becomes one commit (§4.4). */
  private scheduleFlush(): void {
    this.dirty = true;
    this.pendingCount += 1;
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

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    this.writing = true;
    this.syncing = true;
    const attemptedCount = this.pendingCount;

    try {
      this.dirty = false;
      const message =
        attemptedCount === 1 ? "feat: update bookmarks" : `chore: sync ${attemptedCount} changes`;
      const { sha } = await this.client.write(serialize(this.file), message, this.sha ?? undefined);
      this.sha = sha;
      this.etag = null; // the etag we hold is now stale by definition
      this.pendingCount = Math.max(0, this.pendingCount - attemptedCount);
      this.lastSyncedAt = new Date().toISOString();
      this.error = null;
    } catch (e) {
      this.dirty = true; // nothing was committed; keep the changes queued
      if (e instanceof GitHubError && e.kind === "conflict") {
        await this.resolveConflict();
      } else {
        this.error = e as Error;
        if (e instanceof GitHubError && e.kind === "auth") clearToken();
      }
    } finally {
      this.writing = false;
      this.syncing = false;
      // A change that arrived mid-write still needs committing.
      if (this.dirty && !this.error) this.scheduleFlush();
    }
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
      this.error = null;
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
  }
}

export const store = new AppStore();
export { SCHEMA_VERSION };
