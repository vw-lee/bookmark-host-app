/**
 * GitHub Contents API client (README §4.1).
 *
 * Deliberately hand-rolled rather than @octokit/rest (D4): six endpoints, and the retry, ETag
 * and error-taxonomy behaviour would all have to be layered on top anyway.
 */
import { encodeBase64, decodeBase64 } from "./base64";
import { classifyResponse, githubError, GitHubError } from "./errors";

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";

export interface RepoTarget {
  owner: string;
  repo: string;
  path: string;
}

export interface FileContent {
  text: string;
  /** Blob sha, required for the next write. Held in memory only. */
  sha: string;
  etag: string | null;
}

/** A conditional read that hit a 304 — the cached copy is still current, and cost no quota. */
export const NOT_MODIFIED = Symbol("not-modified");

export interface RateLimit {
  remaining: number | null;
  resetAt: number | null;
}

export class GitHubClient {
  private lastRateLimit: RateLimit = { remaining: null, resetAt: null };

  constructor(
    private readonly token: string,
    private readonly target: RepoTarget,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get rateLimit(): RateLimit {
    return this.lastRateLimit;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      ...extra,
    };
  }

  private contentsUrl(): string {
    const { owner, repo, path } = this.target;
    return `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  }

  private recordRateLimit(response: Response): void {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");
    this.lastRateLimit = {
      remaining: remaining === null ? null : Number(remaining),
      resetAt: reset === null ? null : Number(reset) * 1000,
    };
  }

  private async request(url: string, init: RequestInit, onPath: boolean): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch {
      // fetch only rejects for network-level failures; every HTTP status resolves.
      throw githubError("network");
    }
    this.recordRateLimit(response);
    if (!response.ok && response.status !== 304) throw classifyResponse(response, onPath);
    return response;
  }

  /**
   * Verify the token and repository before anything else is attempted (§7, task 1a).
   * Resolves if the repo is reachable with this token; throws a typed error otherwise.
   */
  async probe(): Promise<void> {
    const { owner, repo } = this.target;
    await this.request(
      `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers: this.headers() },
      false,
    );
  }

  /**
   * Read the bookmarks file.
   *
   * Passing `etag` makes the request conditional: a 304 returns NOT_MODIFIED and does not count
   * against the rate limit, which is what makes the foreground refresh poll (3k) nearly free.
   */
  async read(etag?: string | null): Promise<FileContent | typeof NOT_MODIFIED> {
    const headers = this.headers(etag ? { "If-None-Match": etag } : {});
    const response = await this.request(this.contentsUrl(), { headers }, true);

    if (response.status === 304) return NOT_MODIFIED;

    const body = (await response.json()) as {
      content?: string;
      encoding?: string;
      sha?: string;
      size?: number;
    };

    // THE TRAP (§4.3): past 1 MB the API returns 200 with an empty content field and
    // encoding "none". Parsing that as an empty file would render an empty app and then
    // commit that emptiness over the real collection. It must be a hard error.
    if (body.encoding === "none" || (body.content === "" && (body.size ?? 0) > 0)) {
      throw githubError("too-large", 200);
    }

    if (typeof body.content !== "string" || typeof body.sha !== "string") {
      throw githubError("invalid", 200);
    }

    return {
      text: decodeBase64(body.content),
      sha: body.sha,
      etag: response.headers.get("etag"),
    };
  }

  /**
   * Write the file. `sha` must be the blob sha from the last read; omitting it creates the
   * file, which is only correct on first run.
   */
  async write(text: string, message: string, sha?: string): Promise<{ sha: string }> {
    const response = await this.request(
      this.contentsUrl(),
      {
        method: "PUT",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          message,
          content: encodeBase64(text),
          ...(sha ? { sha } : {}),
        }),
      },
      false,
    );

    const body = (await response.json()) as { content?: { sha?: string } };
    const newSha = body.content?.sha;
    if (typeof newSha !== "string") throw githubError("invalid", response.status);
    return { sha: newSha };
  }
}

export { GitHubError };
