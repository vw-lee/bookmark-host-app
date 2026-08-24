<script lang="ts">
  /**
   * Settings (task 7f, brought forward because 3i and 3k need somewhere to be visible).
   *
   * Shows which token storage mode is active AND why (§5.5), and whether persistent storage was
   * granted — a denied grant must be visible rather than silently risking the queue (§6.3).
   */
  import { store, REFRESH_INTERVALS } from "../store.svelte";
  import { getStorageMode } from "../api/tokenStore";
  import { formatBytes } from "../sync/persistence";
  import { theme, type Theme } from "./theme.svelte";

  interface Props {
    onClose: () => void;
  }
  const { onClose }: Props = $props();

  const mode = getStorageMode();
  const onGithubIo = typeof location !== "undefined" && location.hostname.endsWith("github.io");

  const labels: Record<number, string> = {
    0: "Off",
    60_000: "Every minute",
    300_000: "Every 5 minutes",
    900_000: "Every 15 minutes",
  };

  async function grantPersistence() {
    await store.ensurePersistence();
  }

  /**
   * Desktop bookmarklet (task 5d).
   *
   * Offered as copyable text rather than a draggable javascript: anchor. Rendering such an
   * anchor is exactly what §5.4 forbids everywhere else in this app, and carving out an
   * exception for our own markup would weaken a rule whose value is that it has none.
   */
  const appUrl =
    typeof location !== "undefined" ? location.origin + location.pathname.replace(/index\.html$/, "") : "";
  const bookmarklet = `javascript:(function(){window.open('${appUrl}?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'_blank','width=560,height=680')})()`;

  let copied = $state(false);
  async function copyBookmarklet() {
    try {
      await navigator.clipboard.writeText(bookmarklet);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      copied = false;
    }
  }
</script>

<div class="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-16">
  <div
    class="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
  >
    <div class="flex items-center justify-between">
      <h2 class="font-semibold">Settings</h2>
      <button class="text-sm underline" onclick={onClose}>Close</button>
    </div>

    <section class="mt-5">
      <h3 class="text-sm font-medium">Appearance</h3>
      <p class="mt-1 text-sm text-[var(--color-ink-soft)]">
        E-ink cannot be detected automatically — no browser reports the panel type — so choose it
        here. It removes animation entirely, drops greys, and enlarges hit targets.
      </p>
      <div class="mt-2 flex flex-wrap gap-2">
        {#each [["system", "System"], ["light", "Light"], ["dark", "Dark"], ["eink", "E-ink"]] as [value, label] (value)}
          <button
            class="rounded border px-3 py-1.5 text-sm {theme.current === value
              ? 'border-[var(--color-accent)] font-medium'
              : 'border-[var(--color-border)]'}"
            aria-pressed={theme.current === value}
            onclick={() => theme.set(value as Theme)}
          >
            {label}
          </button>
        {/each}
      </div>
    </section>

    <section class="mt-5">
      <h3 class="text-sm font-medium">Token storage</h3>
      <p class="mt-1 text-sm text-[var(--color-ink-soft)]">
        {#if mode === "session"}
          <strong>This tab only.</strong> The token is forgotten when the tab closes.
        {:else}
          <strong>Remembered on this device.</strong>
        {/if}
        {#if onGithubIo}
          This app is served from a github.io address, which shares its storage with every other
          project on that account — so any of them could read a remembered token.
        {/if}
      </p>
    </section>

    <section class="mt-5">
      <h3 class="text-sm font-medium">Offline storage</h3>
      <p class="mt-1 text-sm text-[var(--color-ink-soft)]">
        {#if store.persistence === "granted"}
          Persistent — queued changes survive low disk space.
        {:else if store.persistence === "denied"}
          <span class="text-[var(--color-danger)]">Not persistent.</span> The browser may clear
          queued changes if the device runs low on space. Installing the app usually fixes this.
        {:else}
          This browser does not report a storage persistence state.
        {/if}
      </p>
      {#if store.persistence !== "granted"}
        <button
          class="mt-2 rounded border border-[var(--color-border)] px-3 py-1.5 text-sm"
          onclick={grantPersistence}
        >
          Request persistent storage
        </button>
      {/if}
    </section>

    <section class="mt-5">
      <h3 class="text-sm font-medium">Background refresh</h3>
      <p class="mt-1 text-sm text-[var(--color-ink-soft)]">
        Checks for changes from other devices while this window is open. Unchanged files cost
        nothing against the GitHub rate limit.
      </p>
      <div class="mt-2 flex flex-wrap gap-2">
        {#each REFRESH_INTERVALS as interval (interval)}
          <button
            class="rounded border px-3 py-1.5 text-sm {store.refreshMs === interval
              ? 'border-[var(--color-accent)] font-medium'
              : 'border-[var(--color-border)]'}"
            onclick={() => store.setRefreshInterval(interval)}
          >
            {labels[interval]}
          </button>
        {/each}
      </div>
    </section>

    <section class="mt-5">
      <h3 class="text-sm font-medium">Save from other sites</h3>
      <p class="mt-1 text-sm text-[var(--color-ink-soft)]">
        Create a new browser bookmark, name it "Save to Bookmarks", and paste this as its
        address. Clicking it on any page captures that page.
      </p>
      <pre class="mt-2 max-h-24 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-2 text-xs break-all whitespace-pre-wrap">{bookmarklet}</pre>
      <button
        class="mt-2 rounded border border-[var(--color-border)] px-3 py-1.5 text-sm"
        onclick={copyBookmarklet}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </section>

    <section class="mt-5">
      <h3 class="text-sm font-medium">Privacy</h3>
      <p class="mt-1 text-sm text-[var(--color-ink-soft)]">
        Your bookmarks live in a private repository, so nobody else can read them. But deleting
        a bookmark removes it from the current file, <strong>not from the repository's
        history</strong> — every URL you have ever saved stays recoverable from past commits.
        Removing something permanently means rewriting that history or starting a fresh
        repository.
      </p>
    </section>

    <section class="mt-5">
      <h3 class="text-sm font-medium">Collection</h3>
      <dl class="mt-1 space-y-1 text-sm text-[var(--color-ink-soft)]">
        <div class="flex justify-between">
          <dt>File size</dt>
          <dd>{formatBytes(store.size.bytes)} of 1 MB limit</dd>
        </div>
        <div class="flex justify-between">
          <dt>Bookmarks</dt>
          <dd>{store.file.bookmarks.filter((b) => !b.deletedAt).length}</dd>
        </div>
        <div class="flex justify-between">
          <dt>Deleted (retained 90 days)</dt>
          <dd>{store.file.bookmarks.filter((b) => b.deletedAt).length}</dd>
        </div>
        <div class="flex justify-between">
          <dt>Last synced</dt>
          <dd>{store.lastSyncedAt ? new Date(store.lastSyncedAt).toLocaleTimeString() : "never"}</dd>
        </div>
      </dl>
    </section>
  </div>
</div>
