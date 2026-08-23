import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AppStore } from "../store.svelte";
import { encodeBase64 } from "../api/base64";
import { serialize } from "../schema/serialize";
import { emptyFile } from "../schema/types";
import { measureSize, formatBytes, SIZE_WARN_BYTES } from "./persistence";
import { withWriteLock } from "./tabs";

/** Scripted API, same shape as store.test.ts but with per-call control. */
function scripted(responses: { status?: number; body?: unknown; headers?: Record<string, string> }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const spec = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(JSON.stringify(spec.body ?? {}), {
      status: spec.status ?? 200,
      headers: { "content-type": "application/json", ...(spec.headers ?? {}) },
    });
  });
  return { fetch: impl as unknown as typeof fetch, calls };
}

function fileResponse(text: string, sha = "sha1") {
  return { body: { content: encodeBase64(text), encoding: "base64", sha, size: text.length } };
}

const EMPTY = serialize(emptyFile("2026-08-20T08:00:00.000Z"));

async function connected(responses: Parameters<typeof scripted>[0]) {
  const { fetch: f, calls } = scripted(responses);
  const store = new AppStore();
  await store.connect({ token: "t", owner: "o", repo: "r", path: "p.json" }, null, f);
  return { store, calls };
}

describe("rate-limit parking (task 2d)", () => {
  afterEach(() => vi.useRealTimers());

  it("parks the queue on a 403 with quota exhausted instead of retrying", async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    const { store, calls } = await connected([
      { body: { name: "r" } },
      fileResponse(EMPTY),
      { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } },
    ]);

    store.addBookmark({ url: "https://example.com/a" });
    await store.flush();

    expect(store.isParked()).toBe(true);
    expect(store.parkedUntil).toBe(reset * 1000);

    // A further flush while parked must not issue another request.
    const before = calls.length;
    await store.flush();
    expect(calls.length).toBe(before);
  });

  it("does not park on a 403 that is really a permission failure", async () => {
    const { store } = await connected([
      { body: { name: "r" } },
      fileResponse(EMPTY),
      { status: 403, headers: { "x-ratelimit-remaining": "4999" } },
    ]);

    store.addBookmark({ url: "https://example.com/a" });
    await store.flush();

    expect(store.isParked()).toBe(false);
    expect(store.error).not.toBeNull();
  });
});

describe("offline behaviour (task 3d)", () => {
  it("marks offline on a network failure and keeps the edit queued", async () => {
    const calls: string[] = [];
    let failNext = false;
    const f = vi.fn(async (url: string) => {
      calls.push(url);
      if (failNext) throw new TypeError("Failed to fetch");
      const body =
        calls.length === 1
          ? { name: "r" }
          : { content: encodeBase64(EMPTY), encoding: "base64", sha: "s", size: EMPTY.length };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const store = new AppStore();
    await store.connect({ token: "t", owner: "o", repo: "r", path: "p.json" }, null, f);

    failNext = true;
    store.addBookmark({ url: "https://example.com/offline" });
    await store.flush();

    expect(store.offline).toBe(true);
    // Offline is a state, not an error banner the user must dismiss.
    expect(store.error).toBeNull();
    // The bookmark is still there and still pending.
    expect(store.visible).toHaveLength(1);
    expect(store.pendingCount).toBeGreaterThan(0);
  });

  it("does not attempt a write while offline", async () => {
    const { store, calls } = await connected([{ body: { name: "r" } }, fileResponse(EMPTY)]);
    store.offline = true;
    store.addBookmark({ url: "https://example.com/a" });

    const before = calls.length;
    await store.flush();
    expect(calls.length).toBe(before);
  });
});

describe("background refresh (tasks 3f, 3k)", () => {
  it("merges remote changes rather than discarding local edits", async () => {
    // The dangerous case: a poll fires while the outbox is dirty. Replacing local state with
    // remote would silently drop an unsynced bookmark.
    const remote = {
      ...emptyFile("2026-08-22T08:00:00.000Z"),
      bookmarks: [
        {
          id: "01REMOTEREMOTEREMOTEREMOTE",
          url: "https://remote.example/x",
          urlKey: "remote.example/x",
          title: "Remote",
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

    const { store } = await connected([
      { body: { name: "r" } },
      fileResponse(EMPTY),
      fileResponse(serialize(remote), "sha2"),
    ]);

    store.addBookmark({ url: "https://local.example/y", title: "Local" });
    await store.load({ quiet: true });

    expect(store.visible.map((b) => b.title).sort()).toEqual(["Local", "Remote"]);
  });

  it("a failed quiet poll leaves the working view intact", async () => {
    const { store } = await connected([
      { body: { name: "r" } },
      fileResponse(EMPTY),
      { status: 500 },
    ]);
    store.addBookmark({ url: "https://example.com/keep", title: "Keep" });

    await store.load({ quiet: true });

    expect(store.status).toBe("ready");
    expect(store.error).toBeNull();
    expect(store.visible).toHaveLength(1);
  });

  it("flags that the remote changed so the UI can say so", async () => {
    const { store } = await connected([
      { body: { name: "r" } },
      fileResponse(EMPTY, "sha1"),
      fileResponse(EMPTY, "sha-different"),
    ]);
    expect(store.remoteChangedAt).toBeNull();
    await store.load({ quiet: true });
    expect(store.remoteChangedAt).not.toBeNull();
  });
});

describe("size tripwire (task 3g)", () => {
  it("reports ok well below the warning threshold", () => {
    const report = measureSize(EMPTY);
    expect(report.level).toBe("ok");
    expect(report.bytes).toBeGreaterThan(0);
  });

  it("warns at 700 KB and goes critical at 1 MB", () => {
    expect(measureSize("x".repeat(SIZE_WARN_BYTES)).level).toBe("warn");
    expect(measureSize("x".repeat(1_000_001)).level).toBe("critical");
  });

  it("measures encoded bytes, not code units", () => {
    // A multi-byte character must count as its UTF-8 length, or the tripwire fires late.
    expect(measureSize("📚").bytes).toBe(4);
    expect(measureSize("a").bytes).toBe(1);
  });

  it("formats sizes for display", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1_572_864)).toBe("1.5 MB");
  });

  it("tracks size on the store after a mutation", async () => {
    const { store } = await connected([{ body: { name: "r" } }, fileResponse(EMPTY)]);
    store.addBookmark({ url: "https://example.com/a", title: "A" });
    expect(store.size.bytes).toBeGreaterThan(0);
    expect(store.size.level).toBe("ok");
  });
});

describe("multi-tab write lock (task 3e)", () => {
  beforeEach(() => {
    // jsdom has no Web Locks API; the fallback path must still run the callback.
    expect(navigator.locks).toBeUndefined();
  });

  it("runs the callback even without Web Locks support", async () => {
    const result = await withWriteLock(async () => "ran");
    expect(result).toBe("ran");
  });

  it("serialises callbacks when Web Locks is present", async () => {
    const order: string[] = [];
    let held: Promise<unknown> = Promise.resolve();

    // Minimal Web Locks stand-in that queues requests, which is the behaviour we depend on.
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: (_name: string, fn: () => Promise<unknown>) => {
          const next = held.then(fn);
          held = next.catch(() => {});
          return next;
        },
      },
    });

    const first = withWriteLock(async () => {
      order.push("first-start");
      await new Promise((r) => setTimeout(r, 20));
      order.push("first-end");
    });
    const second = withWriteLock(async () => {
      order.push("second-start");
    });

    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);

    Reflect.deleteProperty(navigator, "locks");
  });
});
