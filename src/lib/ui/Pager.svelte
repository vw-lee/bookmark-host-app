<script lang="ts">
  /**
   * Pagination (task 7c). Not virtual scrolling — see §1.2 and D14.
   *
   * Hidden entirely at one page, so the common case carries no chrome.
   *
   * The buttons name their keyboard equivalents (task 7o). A shortcut only documented in the
   * "?" dialog is one most people never learn, and this is the moment they are thinking about
   * paging.
   */
  import { store } from "../store.svelte";

  const total = $derived(store.visible.length);
  const from = $derived(store.page * store.pageSize + 1);
  const to = $derived(Math.min(total, (store.page + 1) * store.pageSize));
</script>

{#if store.pageCount > 1}
  <nav
    class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm"
    aria-label="Pagination"
  >
    <span class="text-[var(--color-ink-soft)]">{from}–{to} of {total}</span>

    <div class="flex items-center gap-2">
      <button
        class="rounded border border-[var(--color-border)] px-3 py-1 disabled:opacity-40"
        onclick={() => (store.page = Math.max(0, store.page - 1))}
        disabled={store.page === 0}
        title="Previous page (Page Up)"
      >
        Previous
      </button>
      <span class="text-[var(--color-ink-soft)]">
        Page {store.page + 1} of {store.pageCount}
      </span>
      <button
        class="rounded border border-[var(--color-border)] px-3 py-1 disabled:opacity-40"
        onclick={() => (store.page = Math.min(store.pageCount - 1, store.page + 1))}
        disabled={store.page >= store.pageCount - 1}
        title="Next page (Page Down)"
      >
        Next
      </button>
      <span class="hidden text-xs text-[var(--color-ink-soft)] sm:inline">
        <kbd class="rounded border border-[var(--color-border)] px-1">PgUp</kbd>
        /
        <kbd class="rounded border border-[var(--color-border)] px-1">PgDn</kbd>
      </span>
    </div>
  </nav>
{/if}
