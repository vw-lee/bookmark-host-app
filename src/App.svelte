<script lang="ts">
  /**
   * Application shell (tasks 1e–1h, 2a–2b).
   *
   * Loading states are static text rather than spinners — the cheap habit that keeps the
   * Phase 7 e-ink work from becoming an audit (§1.2).
   */
  import { store } from "./lib/store.svelte";
  import { GitHubError } from "./lib/api/errors";
  import { clearConnection } from "./lib/api/tokenStore";
  import Setup from "./lib/ui/Setup.svelte";
  import Unlock from "./lib/ui/Unlock.svelte";
  import BookmarkRow from "./lib/ui/BookmarkRow.svelte";
  import TagTree from "./lib/ui/TagTree.svelte";
  import QuickAdd from "./lib/ui/QuickAdd.svelte";
  import StatusBar from "./lib/ui/StatusBar.svelte";
  import Settings from "./lib/ui/Settings.svelte";
  import ImportExport from "./lib/ui/ImportExport.svelte";
  import BulkTools from "./lib/ui/BulkTools.svelte";
  import InstallPrompt from "./lib/ui/InstallPrompt.svelte";
  import ErrorBanner from "./lib/ui/ErrorBanner.svelte";
  import CommandPalette from "./lib/ui/CommandPalette.svelte";
  import Pager from "./lib/ui/Pager.svelte";
  import { theme } from "./lib/ui/theme.svelte";
  import {
    registerServiceWorker,
    requestBackgroundSync,
    watchInstallPrompt,
    readSharedLink,
    clearShareParams,
  } from "./lib/pwa/install";
  import { liveBookmarks } from "./lib/sync/merge";

  let adding = $state(false);
  let settingsOpen = $state(false);
  let ioOpen = $state(false);
  let bulkOpen = $state(false);
  let paletteOpen = $state(false);
  let installAvailable = $state(false);
  let installDismissed = $state(false);
  let sharedNotice = $state<string | null>(null);
  let searchInput = $state<HTMLInputElement | null>(null);

  // Applied before anything paints, so there is no flash of the wrong theme.
  $effect(() => {
    theme.apply();
  });

  // A filter change means a different result set — start at the top of it.
  $effect(() => {
    void store.query;
    void store.selectedTag;
    void store.showArchived;
    store.page = 0;
  });

  // Deleting, archiving or merging can shrink the list while the user sits on a later page,
  // which would otherwise leave them staring at an empty one with no obvious way back.
  $effect(() => {
    void store.visible.length;
    store.clampPage();
  });

  $effect(() => {
    void (async () => {
      await store.restore();

      // A share arriving before the store is ready would be dropped, so this runs after.
      const shared = readSharedLink(location.search);
      if (shared) {
        const record = store.addBookmark({ url: shared.url, title: shared.title });
        sharedNotice = record ? `Saved "${record.title}"` : "That link could not be saved.";
        clearShareParams();
      }
    })();

    // The worker asks a client to flush when Background Sync fires (task 3j).
    void registerServiceWorker(() => store.flushNow());
    return watchInstallPrompt(() => (installAvailable = true));
  });

  // Register a background sync whenever work is queued, so a close-then-reconnect still
  // commits on Chrome Android (§6.2).
  $effect(() => {
    if (store.pendingCount > 0) void requestBackgroundSync();
  });

  function onKeydown(event: KeyboardEvent) {
    const inField = ["INPUT", "TEXTAREA"].includes((event.target as HTMLElement)?.tagName);

    // Ctrl/Cmd-K opens the palette; Ctrl/Cmd-Shift-K jumps straight to adding.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (event.shiftKey) adding = true;
      else paletteOpen = true;
      return;
    }
    if (event.key === "/" && !inField) {
      event.preventDefault();
      searchInput?.focus();
    }
    if (event.key === "?" && !inField) {
      event.preventDefault();
      paletteOpen = true;
    }
  }

  // Flush on page hide: the 3s debounce would otherwise never fire when a tab is closed (§4.4).
  // On becoming visible again, refresh (task 3f) — the focus trigger only fires on a change,
  // which is why the 3k poll exists alongside it.
  function onVisibilityChange() {
    if (document.visibilityState === "hidden") store.flushNow();
    else store.refreshOnFocus();
  }

  function disconnect() {
    clearConnection();
    store.disconnect();
  }

  const total = $derived(liveBookmarks(store.file).filter((b) => !b.archived).length);
  const errorMessage = $derived(
    store.error instanceof GitHubError ? store.error.message : (store.error?.message ?? null),
  );
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:document onvisibilitychange={onVisibilityChange} />

<ErrorBanner />

{#if store.booting}
  <p class="p-8 text-sm text-[var(--color-ink-soft)]">Starting…</p>
{:else if store.locked}
  <Unlock />
{:else if store.needsSetup}
  <Setup />
{:else}
  <div class="flex min-h-dvh flex-col">
    <!-- Task 7d: first tab stop jumps past the header controls to the list. -->
    <a
      href="#bookmark-list"
      class="sr-only focus:not-sr-only focus:absolute focus:z-70 focus:m-2 focus:rounded focus:bg-[var(--color-surface-raised)] focus:px-3 focus:py-2"
    >
      Skip to bookmarks
    </a>

    <header class="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
      <h1 class="font-semibold">Bookmarks</h1>

      <input
        bind:this={searchInput}
        bind:value={store.query}
        class="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-1.5 text-sm"
        placeholder="Search title, URL, description, tags…  (press /)"
        aria-label="Search bookmarks"
      />

      <button
        class="rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
        onclick={() => (adding = true)}
      >
        Add
      </button>

      <span
        class="w-28 text-right text-xs text-[var(--color-ink-soft)]"
        role="status"
        aria-live="polite"
      >
        {#if store.syncing}
          Syncing…
        {:else if store.pendingCount > 0}
          {store.pendingCount} queued
        {:else if store.offline}
          Offline
        {:else if store.lastSyncedAt}
          Synced
        {/if}
      </span>

      <button
        class="text-xs text-[var(--color-ink-soft)] underline"
        onclick={() => (store.showArchived = !store.showArchived)}
      >
        {store.showArchived ? "Hide archived" : "Show archived"}
      </button>
      <button
        class="text-xs text-[var(--color-ink-soft)] underline"
        onclick={() => (ioOpen = true)}
      >
        Import
      </button>
      <button
        class="text-xs text-[var(--color-ink-soft)] underline"
        onclick={() => (bulkOpen = true)}
      >
        Tools
      </button>
      <button
        class="text-xs text-[var(--color-ink-soft)] underline"
        onclick={() => (settingsOpen = true)}
      >
        Settings
      </button>
      <button class="text-xs text-[var(--color-ink-soft)] underline" onclick={disconnect}>
        Disconnect
      </button>
    </header>

    <InstallPrompt
      available={installAvailable && !installDismissed}
      onDismiss={() => (installDismissed = true)}
    />

    {#if sharedNotice}
      <p class="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm">
        {sharedNotice}
        <button class="underline" onclick={() => (sharedNotice = null)}>dismiss</button>
      </p>
    {/if}

    <StatusBar />

    {#if !store.connected}
      <p class="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm">
        Not connected to GitHub — showing the copy saved on this device.
        <button class="underline" onclick={() => (store.wantsSetup = true)}>Reconnect</button>
      </p>
    {/if}

    {#if errorMessage}
      <p class="border-b border-[var(--color-danger)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm text-[var(--color-danger)]">
        {errorMessage}
      </p>
    {/if}

    {#if store.status === "loading"}
      <p class="p-8 text-sm text-[var(--color-ink-soft)]">Loading your bookmarks…</p>
    {:else}
      <div class="flex flex-1">
        <TagTree
          counts={store.tagCounts}
          selected={store.selectedTag}
          totalCount={total}
          onSelect={(tag) => (store.selectedTag = tag)}
        />

        <main class="flex-1" id="bookmark-list" aria-label="Bookmarks">
          {#if store.visible.length === 0}
            <p class="p-8 text-sm text-[var(--color-ink-soft)]">
              {#if total === 0}
                No bookmarks yet. Press
                <kbd class="rounded border border-[var(--color-border)] px-1">Ctrl</kbd>
                +<kbd class="rounded border border-[var(--color-border)] px-1">Shift</kbd>
                +<kbd class="rounded border border-[var(--color-border)] px-1">K</kbd> to add one,
                or <kbd class="rounded border border-[var(--color-border)] px-1">Ctrl</kbd>
                +<kbd class="rounded border border-[var(--color-border)] px-1">K</kbd> for all
                commands.
              {:else}
                Nothing matches that filter.
              {/if}
            </p>
          {:else}
            {#each store.pageItems as bookmark (bookmark.id)}
              <BookmarkRow
                {bookmark}
                onTag={(tag) => (store.selectedTag = tag)}
                onDelete={(id) => store.deleteBookmark(id)}
                onUpdate={(id, patch) => store.updateBookmark(id, patch)}
              />
            {/each}
          {/if}
          <Pager />
        </main>
      </div>
    {/if}
  </div>
{/if}

{#if adding}
  <QuickAdd onClose={() => (adding = false)} />
{/if}

{#if settingsOpen}
  <Settings onClose={() => (settingsOpen = false)} />
{/if}

{#if ioOpen}
  <ImportExport onClose={() => (ioOpen = false)} />
{/if}

{#if bulkOpen}
  <BulkTools onClose={() => (bulkOpen = false)} />
{/if}

{#if paletteOpen}
  <CommandPalette
    onClose={() => (paletteOpen = false)}
    onAdd={() => (adding = true)}
    onImport={() => (ioOpen = true)}
    onTools={() => (bulkOpen = true)}
    onSettings={() => (settingsOpen = true)}
  />
{/if}
