<script lang="ts">
  /**
   * Pagination (task 7c). Not virtual scrolling — see §1.2 and D14.
   *
   * Hidden entirely at one page, so the common case carries no chrome.
   */
  import { store } from "../store.svelte";

  const total = $derived(store.visible.length);
  const from = $derived(store.page * store.pageSize + 1);
  const to = $derived(Math.min(total, (store.page + 1) * store.pageSize));
</script>

{#if store.pageCount > 1}
  <nav
    class="flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-4 py-3 text-sm"
    aria-label="Pagination"
  >
    <span class="text-[var(--color-ink-soft)]">{from}–{to} of {total}</span>

    <div class="flex items-center gap-2">
      <button
        class="rounded border border-[var(--color-border)] px-3 py-1 disabled:opacity-40"
        onclick={() => (store.page = Math.max(0, store.page - 1))}
        disabled={store.page === 0}
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
      >
        Next
      </button>
    </div>
  </nav>
{/if}
