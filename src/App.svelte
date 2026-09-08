<script lang="ts">
  /**
   * Application shell (tasks 1e–1h, 2a–2b).
   *
   * Loading states are static text rather than spinners — the cheap habit that keeps the
   * Phase 7 e-ink work from becoming an audit (§1.2).
   */
  import { store } from "./lib/store.svelte";
  import { GitHubError } from "./lib/api/errors";
  import { hasWrappedToken } from "./lib/api/tokenStore";
  import Setup from "./lib/ui/Setup.svelte";
  import Unlock from "./lib/ui/Unlock.svelte";
  import BookmarkRow from "./lib/ui/BookmarkRow.svelte";
  import BookmarkCard from "./lib/ui/BookmarkCard.svelte";
  import BookmarkTile from "./lib/ui/BookmarkTile.svelte";
  import BookmarkTable from "./lib/ui/BookmarkTable.svelte";
  import ViewSwitcher from "./lib/ui/ViewSwitcher.svelte";
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
  import { view } from "./lib/ui/viewMode.svelte";
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

  // A screenful differs by mode (7g), so the page size follows it. Page 0 rather than a
  // recomputed offset: after the rows-per-page changes, "the page you were on" no longer names
  // the same bookmarks, and landing somewhere unrelated is worse than landing at the top.
  $effect(() => {
    store.pageSize = view.pageSize;
    store.page = 0;
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
    // `v` cycles List -> Cards -> Tiles -> Table (7g), matching the palette entry.
    if (event.key.toLowerCase() === "v" && !inField && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      view.next();
    }
  }

  // Flush on page hide: the 3s debounce would otherwise never fire when a tab is closed (§4.4).
  // On becoming visible again, refresh (task 3f) — the focus trigger only fires on a change,
  // which is why the 3k poll exists alongside it.
  function onVisibilityChange() {
    if (document.visibilityState === "hidden") store.flushNow();
    else store.refreshOnFocus();
  }

  // "Disconnect" now lives in Settings behind a confirmation (D16). It deletes the token and
  // the repo settings, and one stray click on a header button was enough to make someone redo
  // the whole PAT flow — the exact cost this app is trying to charge only once.
  const canLock = $derived(store.connected && hasWrappedToken());

  /**
   * Is the bookmark UI on screen, rather than one of the full-page forms? (D18)
   *
   * Only the bookmark UI is pinned to the viewport. Setup and Unlock are documents taller than
   * a phone screen, and trapping them in a non-scrolling box would put their Connect button
   * somewhere unreachable.
   */
  const appShell = $derived(!store.booting && !store.locked && !store.needsSetup);

  const total = $derived(liveBookmarks(store.file).filter((b) => !b.archived).length);
  const errorMessage = $derived(
    store.error instanceof GitHubError ? store.error.message : (store.error?.message ?? null),
  );
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:document onvisibilitychange={onVisibilityChange} />

<!--
  Two page shapes (D18).

  The app view is an APPLICATION SHELL: exactly one viewport tall, never scrolling as a whole,
  with the tag sidebar and the bookmark list each scrolling independently. Chrome — header,
  banners, pager — stays put, so the search box and the paging controls are always reachable
  without scrolling back to find them.

  Setup and Unlock are DOCUMENTS: long, read top-to-bottom, and they must scroll normally. So
  the wrapper only becomes a fixed-height flex column when the app view is on screen; the
  document branches keep a plain block box, where their own `mx-auto max-w-2xl` centring
  behaves exactly as it did before.
-->
<div class={appShell ? "flex h-dvh flex-col overflow-hidden" : ""}>
  <ErrorBanner />

  {#if store.booting}
    <p class="p-8 text-sm text-[var(--color-ink-soft)]">Starting…</p>
  {:else if store.locked}
    <Unlock />
  {:else if store.needsSetup}
    <Setup />
  {:else}
    <div class="flex min-h-0 flex-1 flex-col">
    <!-- Task 7d: first tab stop jumps past the header controls to the list. -->
    <a
      href="#bookmark-list"
      class="sr-only focus:not-sr-only focus:absolute focus:z-70 focus:m-2 focus:rounded focus:bg-[var(--color-surface-raised)] focus:px-3 focus:py-2"
    >
      Skip to bookmarks
    </a>

    <!--
      Wrapping, not squeezing (D18). In a fixed shell there is no page scroll to push overflow
      into, so a narrow window would otherwise crush the search box to a few pixels or clip the
      controls off the right edge. The header takes a second row instead.
    -->
    <header
      class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--color-border)] px-4 py-3"
    >
      <h1 class="font-semibold">Bookmarks</h1>

      <input
        bind:this={searchInput}
        bind:value={store.query}
        class="min-w-48 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-1.5 text-sm"
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

      <ViewSwitcher />

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
      {#if canLock}
        <button class="text-xs text-[var(--color-ink-soft)] underline" onclick={() => store.lock()}>
          Lock
        </button>
      {/if}
    </header>

    <InstallPrompt
      available={installAvailable && !installDismissed}
      onDismiss={() => (installDismissed = true)}
    />

    {#if sharedNotice}
      <p class="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm">
        {sharedNotice}
        <button class="underline" onclick={() => (sharedNotice = null)}>dismiss</button>
      </p>
    {/if}

    <StatusBar />

    {#if !store.connected}
      <p class="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm">
        {#if store.offline}
          <!-- Offline is a state to wait out, not a setup to redo — no token is needed here. -->
          Offline — showing the copy saved on this device. Changes sync when the connection
          comes back.
        {:else}
          Not connected to GitHub — showing the copy saved on this device.
          <button class="underline" onclick={() => (store.wantsSetup = true)}>Reconnect</button>
        {/if}
      </p>
    {/if}

    {#if errorMessage}
      <p class="shrink-0 border-b border-[var(--color-danger)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm text-[var(--color-danger)]">
        {errorMessage}
      </p>
    {/if}

    {#if store.status === "loading"}
      <p class="p-8 text-sm text-[var(--color-ink-soft)]">Loading your bookmarks…</p>
    {:else}
      <!-- min-h-0 is load-bearing: without it a flex child refuses to shrink below its content,
           the row grows past the viewport, and neither scroll region below ever scrolls. -->
      <div class="flex min-h-0 flex-1">
        <TagTree
          counts={store.tagCounts}
          selected={store.selectedTag}
          totalCount={total}
          onSelect={(tag) => (store.selectedTag = tag)}
        />

        <main class="flex min-h-0 flex-1 flex-col" aria-label="Bookmarks">
          <!--
            The scroll region is what the skip link targets, and tabindex="-1" is what lets it
            receive that focus. It also earns the keyboard its arrow-key scrolling: a scrollable
            box that cannot be focused cannot be scrolled without a mouse.
          -->
          <div id="bookmark-list" tabindex="-1" class="bm-scroll min-h-0 flex-1">
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
          {:else if view.current === "table"}
            <BookmarkTable
              items={store.pageItems}
              onTag={(tag) => (store.selectedTag = tag)}
              onDelete={(id) => store.deleteBookmark(id)}
              onUpdate={(id, patch) => store.updateBookmark(id, patch)}
            />
          {:else if view.current === "cards"}
            <!-- auto-fill rather than a fixed column count: the grid adapts to the sidebar
                 being open, to a phone, and to a tablet without a breakpoint for each. -->
            <div
              class="bm-grid grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3 p-4"
              role="list"
            >
              {#each store.pageItems as bookmark (bookmark.id)}
                <BookmarkCard
                  {bookmark}
                  onTag={(tag) => (store.selectedTag = tag)}
                  onDelete={(id) => store.deleteBookmark(id)}
                  onUpdate={(id, patch) => store.updateBookmark(id, patch)}
                />
              {/each}
            </div>
          {:else if view.current === "tiles"}
            <div
              class="bm-grid grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2 p-4"
              role="list"
            >
              {#each store.pageItems as bookmark (bookmark.id)}
                <BookmarkTile
                  {bookmark}
                  onDelete={(id) => store.deleteBookmark(id)}
                  onUpdate={(id, patch) => store.updateBookmark(id, patch)}
                />
              {/each}
            </div>
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
          </div>

          <!-- Outside the scroll region: paging controls you have to scroll to reach are the
               reason people think a list has ended. -->
          <Pager />
        </main>
      </div>
    {/if}
    </div>
  {/if}
</div>

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
