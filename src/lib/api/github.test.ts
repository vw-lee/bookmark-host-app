import { describe, it, expect, vi } from "vitest";
import { GitHubClient, NOT_MODIFIED } from "./github";
import { GitHubError } from "./errors";
import { encodeBase64 } from "./base64";

const TARGET = { owner: "victor", repo: "bookmarks", path: "data/bookmarks.json" };

/** Build a mock fetch that returns one scripted response. */
function mockFetch(
  init: { status?: number; body?: unknown; headers?: Record<string, string> } = {},
): typeof fetch {
  const { status = 200, body = {}, headers = {} } = init;
  return vi.fn(async () =>
    new Response(status === 304 ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    }),
  ) as unknown as typeof fetch;
}

function client(fetchImpl: typeof fetch, token = "ghp_test"): GitHubClient {
  return new GitHubClient(token, TARGET, fetchImpl);
}

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "no-error";
  } catch (e) {
    return e instanceof GitHubError ? e.kind : "wrong-type";
  }
}

describe("read — happy path", () => {
  it("decodes content and returns the sha and etag", async () => {
    const fetchImpl = mockFetch({
      body: { content: encodeBase64('{"hello":"wörld 📚"}'), encoding: "base64", sha: "abc123" },
      headers: { etag: 'W/"tag1"' },
    });
    const result = await client(fetchImpl).read();
    expect(result).not.toBe(NOT_MODIFIED);
    const file = result as Exclude<typeof result, typeof NOT_MODIFIED>;
    expect(file.text).toBe('{"hello":"wörld 📚"}');
    expect(file.sha).toBe("abc123");
    expect(file.etag).toBe('W/"tag1"');
  });

  it("sends the token and API version headers", async () => {
    const fetchImpl = mockFetch({ body: { content: encodeBase64("{}"), sha: "s" } });
    await client(fetchImpl, "ghp_secret").read();
    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_secret");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("returns NOT_MODIFIED for a conditional 304", async () => {
    const fetchImpl = mockFetch({ status: 304 });
    expect(await client(fetchImpl).read('W/"tag1"')).toBe(NOT_MODIFIED);
  });

  it("sends If-None-Match when given an etag", async () => {
    const fetchImpl = mockFetch({ status: 304 });
    await client(fetchImpl).read('W/"tag1"');
    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    expect((init.headers as Record<string, string>)["If-None-Match"]).toBe('W/"tag1"');
  });
});

describe("read — the 1 MB trap (§4.3)", () => {
  it("throws rather than parsing an over-size file as empty", async () => {
    // GitHub returns 200 OK with an EMPTY content field once the file passes 1 MB. Treating
    // that as "no bookmarks" would render an empty app and then commit it over real data.
    const fetchImpl = mockFetch({
      body: { content: "", encoding: "none", sha: "abc", size: 2_000_000 },
    });
    expect(await kindOf(client(fetchImpl).read())).toBe("too-large");
  });

  it("also catches an empty content field with a non-zero size", async () => {
    const fetchImpl = mockFetch({
      body: { content: "", encoding: "base64", sha: "abc", size: 1_500_000 },
    });
    expect(await kindOf(client(fetchImpl).read())).toBe("too-large");
  });

  it("still accepts a genuinely empty file", async () => {
    const fetchImpl = mockFetch({
      body: { content: encodeBase64(""), encoding: "base64", sha: "abc", size: 0 },
    });
    const result = await client(fetchImpl).read();
    expect((result as { text: string }).text).toBe("");
  });
});

describe("error taxonomy (§4.5)", () => {
  it("401 is an auth error", async () => {
    expect(await kindOf(client(mockFetch({ status: 401 })).read())).toBe("auth");
  });

  it("404 on the file path is file-missing, so first run can bootstrap", async () => {
    expect(await kindOf(client(mockFetch({ status: 404 })).read())).toBe("file-missing");
  });

  it("404 on the repo probe is not-found", async () => {
    expect(await kindOf(client(mockFetch({ status: 404 })).probe())).toBe("not-found");
  });

  it("409 is a conflict", async () => {
    expect(await kindOf(client(mockFetch({ status: 409 })).write("{}", "msg", "sha"))).toBe(
      "conflict",
    );
  });

  it("422 is treated as a conflict, since that is how a stale sha reports", async () => {
    expect(await kindOf(client(mockFetch({ status: 422 })).write("{}", "msg", "sha"))).toBe(
      "conflict",
    );
  });

  it("403 with remaining 0 is a rate limit, and carries the reset time", async () => {
    const resetSeconds = Math.floor(Date.now() / 1000) + 600;
    const fetchImpl = mockFetch({
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetSeconds) },
    });
    try {
      await client(fetchImpl).read();
      expect.unreachable();
    } catch (e) {
      const err = e as GitHubError;
      expect(err.kind).toBe("rate-limit");
      expect(err.retryAt).toBe(resetSeconds * 1000);
      expect(err.retryable).toBe(true);
    }
  });

  it("403 with quota REMAINING is a permission problem, not a rate limit", async () => {
    // Both wear status 403. Misreading a permission failure as a rate limit would park the
    // write queue forever waiting for a reset that changes nothing.
    const fetchImpl = mockFetch({ status: 403, headers: { "x-ratelimit-remaining": "4999" } });
    expect(await kindOf(client(fetchImpl).read())).toBe("not-found");
  });

  it("429 honours Retry-After", async () => {
    const fetchImpl = mockFetch({ status: 429, headers: { "retry-after": "30" } });
    try {
      await client(fetchImpl).read();
      expect.unreachable();
    } catch (e) {
      const err = e as GitHubError;
      expect(err.kind).toBe("rate-limit");
      expect(err.retryAt).toBeGreaterThan(Date.now() + 25_000);
    }
  });

  it("5xx is a server error and is retryable", async () => {
    expect(await kindOf(client(mockFetch({ status: 503 })).read())).toBe("server");
  });

  it("a fetch rejection is a network error, not a crash", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const kind = await kindOf(client(fetchImpl).read());
    expect(kind).toBe("network");
  });

  it("every error carries a message with no raw status code in it", async () => {
    try {
      await client(mockFetch({ status: 401 })).read();
      expect.unreachable();
    } catch (e) {
      const err = e as GitHubError;
      expect(err.message).toContain("expired");
      expect(err.message).not.toMatch(/\b401\b/);
    }
  });
});

describe("write", () => {
  it("sends base64 content with the sha and returns the new sha", async () => {
    const fetchImpl = mockFetch({ body: { content: { sha: "newsha" } } });
    const result = await client(fetchImpl).write('{"a":1}', "feat: add", "oldsha");
    expect(result.sha).toBe("newsha");

    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body.sha).toBe("oldsha");
    expect(body.message).toBe("feat: add");
    expect(body.content).toBe(encodeBase64('{"a":1}'));
  });

  it("omits sha when creating the file for the first time", async () => {
    const fetchImpl = mockFetch({ body: { content: { sha: "first" } } });
    await client(fetchImpl).write("{}", "chore: bootstrap");
    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    expect(JSON.parse(init.body as string).sha).toBeUndefined();
  });

  it("records rate-limit headers for the UI", async () => {
    const reset = Math.floor(Date.now() / 1000) + 300;
    const fetchImpl = mockFetch({
      body: { content: { sha: "x" } },
      headers: { "x-ratelimit-remaining": "4321", "x-ratelimit-reset": String(reset) },
    });
    const c = client(fetchImpl);
    await c.write("{}", "msg", "sha");
    expect(c.rateLimit.remaining).toBe(4321);
    expect(c.rateLimit.resetAt).toBe(reset * 1000);
  });
});

describe("url construction", () => {
  it("encodes each path segment without escaping the separators", async () => {
    const fetchImpl = mockFetch({ body: { content: encodeBase64("{}"), sha: "s" } });
    await client(fetchImpl).read();
    const [url] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    expect(url).toBe(
      "https://api.github.com/repos/victor/bookmarks/contents/data/bookmarks.json",
    );
  });
});
