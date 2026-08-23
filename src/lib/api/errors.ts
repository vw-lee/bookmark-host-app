/**
 * Error taxonomy (README §4.5).
 *
 * Every failure the GitHub API can hand us maps to exactly one of these, each carrying a
 * message a person can act on. The UI never renders a raw status code.
 */

export type ErrorKind =
  | "auth" // 401 — token invalid or expired
  | "not-found" // 404 — repo missing OR no permission; GitHub does not distinguish
  | "file-missing" // 404 on the path specifically — first run, bootstrap from here
  | "conflict" // 409 / 422 sha mismatch — refetch, merge, retry
  | "rate-limit" // 403 or 429 with the quota exhausted
  | "too-large" // file passed the 1 MB inline ceiling (§4.3)
  | "invalid" // 422 — malformed payload; a bug, do not retry
  | "network" // offline or DNS/TLS failure
  | "server" // 5xx
  | "unknown";

export class GitHubError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly status?: number,
    /** Epoch ms when the rate limit resets, for the countdown in the UI. */
    readonly retryAt?: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }

  /** Is retrying this by itself ever going to work? */
  get retryable(): boolean {
    return this.kind === "network" || this.kind === "server" || this.kind === "rate-limit";
  }
}

const MESSAGES: Record<ErrorKind, string> = {
  auth: "Your GitHub token is invalid or has expired. Reconnect to continue — your unsaved changes are kept.",
  // GitHub deliberately returns 404 rather than 403 for a repo you cannot see, so it is not
  // possible to tell these apart. The message has to cover both.
  "not-found":
    "Repository not found. Either it does not exist, or your token does not grant access to it. Check the owner/repo and that the token has Contents access to this repository.",
  "file-missing": "The bookmarks file does not exist yet.",
  conflict:
    "The file changed on GitHub since it was last read. Merging the two versions and retrying.",
  "rate-limit": "GitHub rate limit reached. Syncing will resume automatically.",
  "too-large":
    "The bookmarks file has grown past 1 MB, which the Contents API cannot return inline. The app must be updated to read it before it can safely write again.",
  invalid: "GitHub rejected the request as malformed. This is a bug in the app, not your data.",
  network: "No connection to GitHub. Changes are saved locally and will sync when you reconnect.",
  server: "GitHub is having problems. Retrying shortly.",
  unknown: "Something went wrong talking to GitHub.",
};

export function githubError(kind: ErrorKind, status?: number, retryAt?: number): GitHubError {
  return new GitHubError(kind, MESSAGES[kind], status, retryAt);
}

/** Map an HTTP response to a typed error. `onPath` distinguishes a missing file from a missing repo. */
export function classifyResponse(response: Response, onPath: boolean): GitHubError {
  const { status } = response;

  if (status === 401) return githubError("auth", status);

  if (status === 404) return githubError(onPath ? "file-missing" : "not-found", status);

  if (status === 409) return githubError("conflict", status);

  if (status === 403 || status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");
    const retryAfter = response.headers.get("retry-after");

    // A 403 is only a rate limit when the quota is actually exhausted or GitHub told us to
    // back off; otherwise it is a permission problem wearing the same status code.
    if (remaining === "0" || retryAfter || status === 429) {
      const retryAt = retryAfter
        ? Date.now() + Number(retryAfter) * 1000
        : reset
          ? Number(reset) * 1000
          : Date.now() + 60_000;
      return githubError("rate-limit", status, retryAt);
    }
    return githubError("not-found", status);
  }

  if (status === 422) return githubError("conflict", status);
  if (status >= 500) return githubError("server", status);

  return githubError("unknown", status);
}
