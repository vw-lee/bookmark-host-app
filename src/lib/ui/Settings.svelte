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
