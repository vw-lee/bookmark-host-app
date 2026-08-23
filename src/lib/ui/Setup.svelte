<script lang="ts">
  /**
   * First-run setup (task 1a).
   *
   * Three steps, because step 2 is the wall: creating a fine-grained PAT is a form most people
   * have never seen. The deep links and the exact settings are spelled out rather than
   * described, and the token is validated against the real repo before it is accepted, so a
   * wrong scope fails here rather than on the first save.
   */
  import { store } from "../store.svelte";
  import { loadTarget, type StorageMode } from "../api/tokenStore";
  import { GitHubError } from "../api/errors";
  import { errorLog } from "./errorLog.svelte";

  const saved = loadTarget();

  let owner = $state(saved?.owner ?? "");
  let repo = $state(saved?.repo ?? "");
  let path = $state(saved?.path ?? "data/bookmarks.json");
  let token = $state("");
  let mode = $state<StorageMode>("session");
  let busy = $state(false);
  let message = $state<string | null>(null);
  let detail = $state<string | null>(null);
  /** Which step the attempt reached, so a failure says where it stopped rather than just that it did. */
  let step = $state<string | null>(null);

  const tokenUrl = "https://github.com/settings/personal-access-tokens/new";

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    message = null;
    detail = null;
    busy = true;
    step = "Checking the repository…";

    const trimmed = {
      token: token.trim(),
      owner: owner.trim(),
      repo: repo.trim(),
      path: path.trim(),
    };

    // Validate before any network call, so an obvious mistake is named immediately rather
    // than coming back as a confusing 404 from GitHub.
    if (!trimmed.owner || !trimmed.repo) {
      message = "Enter both the owner and the repository name.";
      busy = false;
      step = null;
      return;
    }
    if (trimmed.owner.includes("/") || trimmed.repo.includes("/")) {
      message = 'Enter the owner and repository separately — for example "victor" and "bookmarks", not "victor/bookmarks".';
      busy = false;
      step = null;
      return;
    }
    if (!trimmed.token) {
      message = "Paste your access token.";
      busy = false;
      step = null;
      return;
    }

    try {
      await store.connect(trimmed, mode);
      token = "";
      step = null;
    } catch (e) {
      if (e instanceof GitHubError) {
        message = e.message;
        detail = `${e.kind}${e.status ? ` (HTTP ${e.status})` : ""} — ${trimmed.owner}/${trimmed.repo}`;
      } else {
        const err = e as Error;
        message = err?.message || "Something went wrong and the app could not say what.";
        detail = err?.stack ?? String(e);
        // Anything untyped reaching here is a bug, not a user mistake — record it centrally.
        errorLog.push("Connection failed unexpectedly", e);
      }
      step = null;
    } finally {
      busy = false;
    }
  }
</script>

<div class="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-12">
  <h1 class="text-2xl font-semibold">Bookmarks</h1>
  <p class="mt-2 text-[var(--color-ink-soft)]">
    Your bookmarks are stored as a JSON file in a private GitHub repository that you own. This
    app runs entirely in your browser — nothing is sent anywhere else.
  </p>

  <ol class="mt-8 space-y-6">
    <li>
      <h2 class="font-medium">1 · Create a private repository</h2>
      <p class="mt-1 text-sm text-[var(--color-ink-soft)]">
        <a
          class="text-[var(--color-accent)] underline"
          href="https://github.com/new"
          target="_blank"
          rel="noopener noreferrer">Create one on GitHub</a
        >, set it to Private, and note the owner and name.
      </p>
    </li>

    <li>
      <h2 class="font-medium">2 · Create a fine-grained access token</h2>
      <p class="mt-1 text-sm text-[var(--color-ink-soft)]">
        <a class="text-[var(--color-accent)] underline" href={tokenUrl} target="_blank" rel="noopener noreferrer"
          >Open the token page</a
        > and set exactly these:
      </p>
      <ul class="mt-2 space-y-1 text-sm text-[var(--color-ink-soft)]">
        <li>· <strong>Repository access</strong> — Only select repositories → your new repo</li>
        <li>· <strong>Permissions</strong> → Repository permissions → <strong>Contents: Read and write</strong></li>
        <li>· Nothing else. No other permission is needed or requested.</li>
      </ul>
    </li>

    <li>
      <h2 class="font-medium">3 · Connect</h2>
      <form class="mt-3 space-y-3" onsubmit={submit}>
        <div class="flex gap-3">
          <label class="flex-1 text-sm">
            <span class="text-[var(--color-ink-soft)]">Owner</span>
            <input
              class="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2"
              bind:value={owner}
              placeholder="your-username"
              required
              autocomplete="off"
            />
          </label>
          <label class="flex-1 text-sm">
            <span class="text-[var(--color-ink-soft)]">Repository</span>
            <input
              class="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2"
              bind:value={repo}
              placeholder="bookmarks"
              required
              autocomplete="off"
            />
          </label>
        </div>

        <label class="block text-sm">
          <span class="text-[var(--color-ink-soft)]">File path</span>
          <input
            class="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2"
            bind:value={path}
            required
            autocomplete="off"
          />
        </label>

        <label class="block text-sm">
          <span class="text-[var(--color-ink-soft)]">Access token</span>
          <input
            class="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 font-mono text-xs"
            bind:value={token}
            type="password"
            placeholder="github_pat_..."
            required
            autocomplete="off"
            spellcheck="false"
          />
        </label>

        <fieldset class="rounded border border-[var(--color-border)] p-3 text-sm">
          <legend class="px-1 text-[var(--color-ink-soft)]">Keep me signed in</legend>
          <label class="flex items-start gap-2">
            <input type="radio" bind:group={mode} value="session" class="mt-1" />
            <span>
              <strong>This tab only</strong> — recommended.
              <span class="block text-[var(--color-ink-soft)]"
                >The token is forgotten when the tab closes.</span
              >
            </span>
          </label>
          <label class="mt-2 flex items-start gap-2">
            <input type="radio" bind:group={mode} value="local" class="mt-1" />
            <span>
              <strong>Remember on this device</strong>
              <span class="block text-[var(--color-ink-soft)]">
                Convenient, but this app is hosted on a github.io address that is shared with
                every other project on that account. Any of them could read the token. Prefer
                this only on a device that is solely yours.
              </span>
            </span>
          </label>
        </fieldset>

        {#if message}
          <div class="rounded border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">
            <p>{message}</p>
            {#if detail}
              <details class="mt-1">
                <summary class="cursor-pointer text-xs">Technical detail</summary>
                <pre class="mt-1 overflow-x-auto text-xs whitespace-pre-wrap">{detail}</pre>
              </details>
            {/if}
          </div>
        {/if}

        {#if busy && step}
          <p class="text-sm text-[var(--color-ink-soft)]">{step}</p>
        {/if}

        <button
          class="w-full rounded bg-[var(--color-accent)] px-4 py-2 font-medium text-white disabled:opacity-60"
          type="submit"
          disabled={busy}
        >
          {busy ? "Checking…" : "Connect"}
        </button>
      </form>
    </li>
  </ol>
</div>
