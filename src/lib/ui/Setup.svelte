<script lang="ts">
  /**
   * Connection form (task 1a, D16).
   *
   * Two shapes, one form. FIRST RUN is three steps, because step 2 is the wall: creating a
   * fine-grained PAT is a form most people have never seen, so the deep links and the exact
   * settings are spelled out rather than described.
   *
   * RECONNECT is what someone who has already done all that sees when their token finally
   * expires. Showing them the wall a second time is the thing this variant exists to stop:
   * the repository is already known, so the only question is the new token. The instructions
   * are still one click away for the one part that is genuinely being redone.
   */
  import { store } from "../store.svelte";
  import { loadTarget, getStorageMode, type StorageMode } from "../api/tokenStore";
  import { MIN_PIN_LENGTH, cryptoAvailable } from "../api/tokenCrypto";
  import { GitHubError } from "../api/errors";
  import { liveBookmarks } from "../sync/merge";
  import { errorLog } from "./errorLog.svelte";

  const saved = loadTarget();

  let owner = $state(saved?.owner ?? "");
  let repo = $state(saved?.repo ?? "");
  let path = $state(saved?.path ?? "data/bookmarks.json");
  let token = $state("");
  // A returning user keeps whatever they chose last time; a new one gets the safest option.
  let mode = $state<StorageMode>(
    saved ? getStorageMode() : cryptoAvailable() ? "pin" : "session",
  );
  let pin = $state("");
  let busy = $state(false);
  let message = $state<string | null>(null);
  let detail = $state<string | null>(null);
  /** Which step the attempt reached, so a failure says where it stopped rather than just that it did. */
  let step = $state<string | null>(null);

  /** The repository is already known, so this is a token replacement, not a setup. */
  let reconnect = $state(saved !== null);

  /** With bookmarks already on the device, reconnecting can wait — reading them cannot. */
  const hasCachedData = $derived(liveBookmarks(store.file).length > 0);

  function later() {
    // The stored expiry flag stays set, so the next launch asks again; this only dismisses
    // the screen so the offline copy is reachable now.
    store.tokenExpired = false;
    store.wantsSetup = false;
  }

  const tokenUrl = "https://github.com/settings/personal-access-tokens/new";

  // If this does not change after a code change, the page is being served from a cache.
  const build = typeof __BUILD_STAMP__ === "string" ? __BUILD_STAMP__ : "unknown";

  function startOver() {
    reconnect = false;
    owner = "";
    repo = "";
    path = "data/bookmarks.json";
    token = "";
    pin = "";
    mode = cryptoAvailable() ? "pin" : "session";
    message = null;
    detail = null;
  }

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

    if (mode === "pin" && pin.length < MIN_PIN_LENGTH) {
      message = `Use a passphrase of at least ${MIN_PIN_LENGTH} characters.`;
      busy = false;
      step = null;
      return;
    }

    try {
      await store.connect(trimmed, mode);
      // Only wrapped once the token is known to work — storing a bad one helps nobody.
      if (mode === "pin") await store.setPin(trimmed, pin);
      token = "";
      pin = "";
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

{#snippet tokenInstructions()}
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
{/snippet}

{#snippet storageChoice()}
  <fieldset class="rounded border border-[var(--color-border)] p-3 text-sm">
    <legend class="px-1 text-[var(--color-ink-soft)]">Keep me signed in</legend>

    {#if cryptoAvailable()}
      <label class="flex items-start gap-2">
        <input type="radio" bind:group={mode} value="pin" class="mt-1" />
        <span>
          <strong>Protect with a passphrase</strong> — recommended.
          <span class="block text-[var(--color-ink-soft)]">
            The token is encrypted on this device and unlocked with a passphrase, so you never
            re-paste it. Another page on this shared github.io address would find only
            ciphertext it cannot open.
          </span>
        </span>
      </label>

      {#if mode === "pin"}
        <label class="mt-2 block pl-6 text-sm">
          <span class="text-[var(--color-ink-soft)]">
            {#if reconnect}
              Passphrase — the same one you already use, unless you want to change it
            {:else}
              Passphrase (at least {MIN_PIN_LENGTH} characters — length matters far more than
              symbols)
            {/if}
          </span>
          <input
            bind:value={pin}
            type="password"
            class="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2"
            autocomplete="new-password"
          />
        </label>
      {/if}

      <hr class="my-3 border-[var(--color-border)]" />
    {/if}

    <label class="flex items-start gap-2">
      <input type="radio" bind:group={mode} value="session" class="mt-1" />
      <span>
        <strong>This tab only</strong>
        <span class="block text-[var(--color-ink-soft)]"
          >The token is forgotten when the tab closes, so you paste it again next time.</span
        >
      </span>
    </label>
    <label class="mt-2 flex items-start gap-2">
      <input type="radio" bind:group={mode} value="local" class="mt-1" />
      <span>
        <strong>Remember on this device</strong>
        <span class="block text-[var(--color-ink-soft)]">
          Convenient, but this app is hosted on a github.io address that is shared with every
          other project on that account. Any of them could read the token. Prefer this only on
          a device that is solely yours.
        </span>
      </span>
    </label>
  </fieldset>
{/snippet}

{#snippet fields()}
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
{/snippet}

{#snippet problem()}
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
{/snippet}

{#if reconnect}
  <div class="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-12">
    <h1 class="text-2xl font-semibold">
      {store.tokenExpired ? "Your access token expired" : "Reconnect"}
    </h1>
    <p class="mt-2 text-sm text-[var(--color-ink-soft)]">
      {#if store.tokenExpired}
        GitHub is no longer accepting the saved token — fine-grained tokens expire on a fixed
        date. Everything else is still set up, so this needs one new token and nothing more.
      {:else}
        Paste a token for <strong>{saved?.owner}/{saved?.repo}</strong> to sync again.
      {/if}
      Your bookmarks and any unsynced changes are safe on this device.
    </p>

    <form class="mt-6 space-y-3" onsubmit={submit}>
      {@render fields()}
      <details class="rounded border border-[var(--color-border)] px-3 py-2 text-sm">
        <summary class="cursor-pointer text-[var(--color-ink-soft)]">
          How do I create a new token?
        </summary>
        {@render tokenInstructions()}
      </details>
      {@render storageChoice()}
      {@render problem()}

      <button
        class="w-full rounded bg-[var(--color-accent)] px-4 py-2 font-medium text-white disabled:opacity-60"
        type="submit"
        disabled={busy}
      >
        {busy ? "Checking…" : "Reconnect"}
      </button>
    </form>

    <div class="mt-6 flex flex-wrap gap-4 text-xs text-[var(--color-ink-soft)]">
      {#if hasCachedData}
        <button class="underline" onclick={later}>
          Not now — read the copy on this device
        </button>
      {/if}
      <button class="underline" onclick={startOver}>Use a different repository instead</button>
    </div>

    <p class="mt-8 text-center text-xs text-[var(--color-ink-soft)]">build {build}</p>
  </div>
{:else}
  <div class="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-12">
    <h1 class="text-2xl font-semibold">Bookmarks</h1>
    <p class="mt-2 text-[var(--color-ink-soft)]">
      Your bookmarks are stored as a JSON file in a private GitHub repository that you own. This
      app runs entirely in your browser — nothing is sent anywhere else.
    </p>

    <!-- Task 7e: stated before anything is saved, not buried in settings afterwards. -->
    <p class="mt-3 rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink-soft)]">
      <strong>Worth knowing first:</strong> because storage is a git repository, deleting a
      bookmark later removes it from the current file but <strong>not from the repository's
      history</strong>. Every URL you save stays recoverable from past commits unless you rewrite
      that history.
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
        {@render tokenInstructions()}
      </li>

      <li>
        <h2 class="font-medium">3 · Connect</h2>
        <form class="mt-3 space-y-3" onsubmit={submit}>
          {@render fields()}
          {@render storageChoice()}
          {@render problem()}

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

    <p class="mt-8 text-center text-xs text-[var(--color-ink-soft)]">build {build}</p>
  </div>
{/if}
