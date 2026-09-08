<script lang="ts">
  /**
   * Sync state, rendered as static text rather than spinners — the cheap habit that keeps the
   * Phase 7 e-ink work from becoming an audit (§1.2).
   *
   * Every state here is one the user may need to act on: offline with work queued, parked on a
   * rate limit, storage that could be evicted, or a file approaching the 1 MB ceiling.
   */
  import { store } from "../store.svelte";
  import { formatBytes, SIZE_WARN_BYTES } from "../sync/persistence";

  let now = $state(Date.now());

  // Ticks only while a countdown is actually showing.
  $effect(() => {
    if (store.parkedUntil === null) return;
    const id = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(id);
  });

  const parkedSeconds = $derived(
    store.parkedUntil ? Math.max(0, Math.ceil((store.parkedUntil - now) / 1000)) : 0,
  );

  /** Persistence only matters when there is something queued that could be lost (§6.3). */
  const atRisk = $derived(store.persistence !== "granted" && store.pendingCount > 0);
</script>

{#if store.offline}
  <p role="status" aria-live="polite" class="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm">
    Offline. {store.pendingCount > 0
      ? `${store.pendingCount} change${store.pendingCount === 1 ? "" : "s"} saved here and waiting to sync.`
      : "Changes are saved here and will sync when you reconnect."}
  </p>
{:else if store.parkedUntil !== null && parkedSeconds > 0}
  <p role="status" aria-live="polite" class="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm">
    GitHub rate limit reached. Syncing resumes in {parkedSeconds}s — nothing is lost.
  </p>
{/if}

{#if atRisk}
  <p class="shrink-0 border-b border-[var(--color-danger)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm text-[var(--color-danger)]">
    This browser has not granted persistent storage, so queued changes could be cleared if the
    device runs low on space. Installing the app usually grants it.
  </p>
{/if}

{#if store.size.level !== "ok"}
  <p class="shrink-0 border-b border-[var(--color-danger)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm text-[var(--color-danger)]">
    Your bookmarks file is {formatBytes(store.size.bytes)}.
    {#if store.size.level === "critical"}
      It has passed the 1 MB limit the GitHub Contents API can return, so the app must be
      updated to read it before it can safely write again.
    {:else}
      Past {formatBytes(SIZE_WARN_BYTES)} it approaches the 1 MB limit the GitHub Contents API
      can return inline.
    {/if}
  </p>
{/if}

{#if store.remoteChangedAt}
  <p class="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm">
    Updated with changes from another device.
    <button
      class="underline"
      onclick={() => (store.remoteChangedAt = null)}
      aria-label="Dismiss">dismiss</button
    >
  </p>
{/if}
