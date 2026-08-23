import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppStore } from "./store.svelte";
import { encodeBase64 } from "./api/base64";
import { serialize } from "./schema/serialize";
import { emptyFile } from "./schema/types";

/**
 * Store-level tests against a scripted GitHub API. These exercise the paths that the unit
 * tests cannot reach: bootstrap on first run, dedupe on add, tombstones on delete, and the
 * conflict retry.
 */

interface Call {
  url: string;
  init: RequestInit;
}

function scriptedFetch(responses: { status?: number; body?: unknown }[]): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  let i = 0;
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const spec = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(JSON.stringify(spec.body ?? {}), {
      status: spec.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch: impl as unknown as typeof fetch, calls };
}

function fileResponse(text: string, sha = "sha1") {
  return { body: { content: encodeBase64(text), encoding: "base64", sha, size: text.length } };
}

function connect(store: AppStore, fetchImpl: typeof fetch) {
  // Inject the scripted fetch through the client the store builds.
  return store.connect(
    { token: "t", owner: "o", repo: "r", path: "data/bookmarks.json" },
    null,
    fetchImpl,
  );
}

describe("AppStore — first run (task 1d)", () => {
  it("bootstraps the file when the path 404s", async () => {
    const { fetch: f, calls } = scriptedFetch([
      { body: { name: "r" } }, // probe
      { status: 404 }, // read -> file missing
      { body: { content: { sha: "new" } } }, // bootstrap write
    ]);
    const store = new AppStore();
    await connect(store, f);

    expect(store.status).toBe("ready");
    expect(store.file.bookmarks).toEqual([]);

    const write = calls.at(-1)!;
    expect(write.init.method).toBe("PUT");
    const body = JSON.parse(write.init.body as string);
    expect(body.message).toContain("initialise");
    expect(body.sha).toBeUndefined(); // creating, not updating
  });

  it("surfaces an auth failure without connecting", async () => {
    const { fetch: f } = scriptedFetch([{ status: 401 }]);
    const store = new AppStore();
    await expect(connect(store, f)).rejects.toThrow();
    expect(store.connected).toBe(false);
    expect(store.status).toBe("error");
  });
});

describe("AppStore — reading", () => {
  it("loads, validates, and exposes live bookmarks", async () => {
    const seeded = {
      ...emptyFile("2026-08-20T08:00:00.000Z"),
      bookmarks: [
        {
          id: "01AAAAAAAAAAAAAAAAAAAAAAAA",
          url: "https://example.com/a",
          urlKey: "example.com/a",
          title: "Alpha",
          description: "",
          notes: "",
          tags: ["dev/rust"],
          favicon: null,
          pinned: false,
          archived: false,
          createdAt: "2026-08-20T08:00:00.000Z",
          updatedAt: "2026-08-20T08:00:00.000Z",
          deletedAt: null,
          enrichedAt: null,
        },
      ],
    };
    const { fetch: f } = scriptedFetch([{ body: { name: "r" } }, fileResponse(serialize(seeded))]);
    const store = new AppStore();
    await connect(store, f);

    expect(store.status).toBe("ready");
    expect(store.visible).toHaveLength(1);
    expect(store.visible[0]!.title).toBe("Alpha");
    // Derived ancestor node exists even though nothing is tagged "dev" (§3.3.1).
    expect(store.tagCounts.get("dev")!.total).toBe(1);
    expect(store.tagCounts.get("dev")!.exact).toBe(0);
  });

  it("migrates a v1 file on load", async () => {
    const v1 = JSON.stringify({
      version: "1.0",
      lastUpdated: "2026-08-20T08:00:00.000Z",
      tags: ["docs"],
      bookmarks: [
        {
          id: "old-uuid",
          url: "https://example.com",
          title: "Legacy",
          tags: ["Tools"],
          folder: "Development",
          createdAt: "2026-08-20T08:00:00.000Z",
        },
      ],
    });
    const { fetch: f } = scriptedFetch([{ body: { name: "r" } }, fileResponse(v1)]);
    const store = new AppStore();
    await connect(store, f);

    expect(store.file.schemaVersion).toBe(2);
    expect(store.visible[0]!.tags).toEqual(["development", "tools"]);
  });

  it("refuses an over-size file rather than showing an empty app", async () => {
    // If this regressed, the app would render "no bookmarks" and then commit that.
    const { fetch: f } = scriptedFetch([
      { body: { name: "r" } },
      { body: { content: "", encoding: "none", sha: "s", size: 2_000_000 } },
    ]);
    const store = new AppStore();
    await connect(store, f);
    expect(store.status).toBe("error");
    expect(store.file.bookmarks).toEqual([]);
    expect(String(store.error?.message)).toContain("1 MB");
  });
});

describe("AppStore — mutations", () => {
  let store: AppStore;

  beforeEach(async () => {
    const { fetch: f } = scriptedFetch([
      { body: { name: "r" } },
      fileResponse(serialize(emptyFile("2026-08-20T08:00:00.000Z"))),
      { body: { content: { sha: "next" } } },
    ]);
    store = new AppStore();
    await connect(store, f);
  });

  it("adds a bookmark, deriving urlKey and normalising tags", () => {
    const record = store.addBookmark({
      url: "https://www.Example.com/page/?utm_source=x",
      title: "Example",
      tags: ["Dev/Rust", "dev/rust", " tools "],
    });
    expect(record).not.toBeNull();
    expect(record!.urlKey).toBe("example.com/page");
    expect(record!.tags).toEqual(["dev/rust", "tools"]);
  });

  it("refuses an unsafe URL", () => {
    expect(store.addBookmark({ url: "javascript:alert(1)" })).toBeNull();
    expect(store.file.bookmarks).toHaveLength(0);
  });

  it("falls back to the hostname when no title is given", () => {
    const record = store.addBookmark({ url: "https://example.com/deep/path" });
    expect(record!.title).toBe("example.com");
  });

  it("updates in place instead of duplicating the same link (task 2g)", () => {
    store.addBookmark({ url: "https://example.com/p", title: "First", tags: ["a"] });
    store.addBookmark({ url: "http://www.example.com/p/?utm_source=n", title: "Second", tags: ["b"] });

    expect(store.file.bookmarks).toHaveLength(1);
    expect(store.visible[0]!.title).toBe("Second");
    expect(store.visible[0]!.tags).toEqual(["a", "b"]);
  });

  it("deletes by writing a tombstone, not by removing the record", () => {
    const record = store.addBookmark({ url: "https://example.com/p" })!;
    store.deleteBookmark(record.id);

    expect(store.visible).toHaveLength(0);
    // The record survives so the deletion can win a merge on another device (§3.1).
    expect(store.file.bookmarks).toHaveLength(1);
    expect(store.file.bookmarks[0]!.deletedAt).not.toBeNull();
  });

  it("bumps updatedAt on edit so merge can order the change", () => {
    const record = store.addBookmark({ url: "https://example.com/p", title: "One" })!;
    const before = record.updatedAt;
    vi.setSystemTime(new Date(Date.parse(before) + 5000));
    store.updateBookmark(record.id, { title: "Two" });
    const after = store.file.bookmarks[0]!;
    expect(after.title).toBe("Two");
    expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(before));
    vi.useRealTimers();
  });
});

describe("AppStore — search and filtering", () => {
  let store: AppStore;

  beforeEach(async () => {
    const { fetch: f } = scriptedFetch([
      { body: { name: "r" } },
      fileResponse(serialize(emptyFile("2026-08-20T08:00:00.000Z"))),
      { body: { content: { sha: "next" } } },
    ]);
    store = new AppStore();
    await connect(store, f);
    store.addBookmark({ url: "https://rust-lang.org", title: "Rust", tags: ["dev/rust"] });
    store.addBookmark({ url: "https://go.dev", title: "Go", tags: ["dev/go"] });
    store.addBookmark({ url: "https://news.example.com", title: "News", tags: ["development"] });
  });

  it("filters by title, url, and tag", () => {
    store.query = "rust";
    expect(store.visible.map((b) => b.title)).toEqual(["Rust"]);
    store.query = "go.dev";
    expect(store.visible.map((b) => b.title)).toEqual(["Go"]);
  });

  it("includes descendants when a parent tag is selected (§3.3.2)", () => {
    store.query = "";
    store.selectedTag = "dev";
    expect(store.visible.map((b) => b.title).sort()).toEqual(["Go", "Rust"]);
  });

  it("does not match a sibling tag that merely shares a prefix", () => {
    // "development" must NOT appear under "dev".
    store.selectedTag = "dev";
    expect(store.visible.map((b) => b.title)).not.toContain("News");
  });

  it("sorts pinned bookmarks first", () => {
    const go = store.file.bookmarks.find((b) => b.title === "Go")!;
    store.updateBookmark(go.id, { pinned: true });
    store.selectedTag = null;
    expect(store.visible[0]!.title).toBe("Go");
  });
});

describe("AppStore — conflict resolution (task 3a)", () => {
  it("refetches, merges, and retries on a 409", async () => {
    const remote = {
      ...emptyFile("2026-08-22T08:00:00.000Z"),
      bookmarks: [
        {
          id: "01REMOTEREMOTEREMOTEREMOTE",
          url: "https://remote.example/x",
          urlKey: "remote.example/x",
          title: "From another device",
          description: "",
          notes: "",
          tags: [],
          favicon: null,
          pinned: false,
          archived: false,
          createdAt: "2026-08-22T08:00:00.000Z",
          updatedAt: "2026-08-22T08:00:00.000Z",
          deletedAt: null,
          enrichedAt: null,
        },
      ],
    };

    const { fetch: f } = scriptedFetch([
      { body: { name: "r" } }, // probe
      fileResponse(serialize(emptyFile("2026-08-20T08:00:00.000Z"))), // initial read
      { status: 409 }, // first write rejected — stale sha
      fileResponse(serialize(remote), "sha2"), // refetch
      { body: { content: { sha: "merged" } } }, // retry write
    ]);

    const store = new AppStore();
    await connect(store, f);
    store.addBookmark({ url: "https://local.example/y", title: "Local" });
    await store.flush();

    const titles = store.visible.map((b) => b.title).sort();
    expect(titles).toEqual(["From another device", "Local"]);
    expect(store.error).toBeNull();
  });
});
