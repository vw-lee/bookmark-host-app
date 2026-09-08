<script lang="ts">
  /**
   * The dense table view (task 7g).
   *
   * A real <table> rather than a grid of divs: the column headers are the sort control, and
   * `aria-sort` on a <th> is the only way a screen reader announces which column is ordering
   * the data. Faking that with ARIA on divs is more markup for a worse result.
   *
   * Sorting writes to the store rather than staying local, so the order a user chose here is
   * the order they see after switching to cards — a column header that silently stops applying
   * when the view changes would read as a bug.
   */
  import type { Bookmark } from "../schema/types";
  import { isSafeUrl } from "../schema/normalize";
  import { store } from "../store.svelte";
  import { hostOf, SORT_LABELS, type SortKey } from "./sort";
  import BookmarkEditForm from "./BookmarkEditForm.svelte";
  import BookmarkActions from "./BookmarkActions.svelte";
  import DomainTile from "./DomainTile.svelte";
  import SelectBox from "./SelectBox.svelte";

  interface Props {
    items: Bookmark[];
    onTag: (tag: string) => void;
    onDelete: (id: string) => void;
    onUpdate: (id: string, patch: Partial<Bookmark>) => void;
    /** Where the keyboard cursor is on this page, or -1 (task 7m). */
    focusedIndex?: number;
  }

  const { items, onTag, onDelete, onUpdate, focusedIndex = -1 }: Props = $props();

  // Which row is being edited. This moved to the store (task 7m) so the `e` shortcut can open
  // one, and so the "only one form at a time" rule this view already had holds everywhere.

  const columns: { key: SortKey; className: string }[] = [
    { key: "title", className: "" },
    { key: "host", className: "hidden md:table-cell" },
    { key: "updated", className: "hidden lg:table-cell" },
    { key: "added", className: "hidden sm:table-cell" },
  ];

  /**
   * Clicking the active column flips direction; clicking a new one adopts that column's natural
   * default — text reads A–Z, dates read newest-first. Always starting ascending would put the
   * oldest bookmarks on page one, which nobody wants.
   */
  function sortBy(key: SortKey) {
    if (store.sortKey === key) {
      store.sortDir = store.sortDir === "asc" ? "desc" : "asc";
    } else {
      store.sortKey = key;
      store.sortDir = key === "title" || key === "host" ? "asc" : "desc";
    }
    store.page = 0;
  }

  function ariaSort(key: SortKey): "ascending" | "descending" | "none" {
    if (store.sortKey !== key) return "none";
    return store.sortDir === "asc" ? "ascending" : "descending";
  }

  /** Date only — a bookmark list has no use for the time, and it costs a column's width. */
  function shortDate(iso: string): string {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "—";
    return new Date(t).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  const cell = "px-3 py-2 align-top";
</script>

<!-- Narrow screens scroll the table rather than the page: §1.2 wants a static layout. -->
<div class="overflow-x-auto">
  <table class="w-full border-collapse text-sm">
    <thead>
      <tr class="border-b border-[var(--color-border)] text-left">
        {#each columns as column (column.key)}
          <th scope="col" class="{cell} {column.className} font-medium" aria-sort={ariaSort(column.key)}>
            <button
              class="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-[var(--color-surface-raised)]"
              onclick={() => sortBy(column.key)}
            >
              {SORT_LABELS[column.key]}
              <!-- A caret, not colour: §1.2 forbids colour-only signalling. -->
              <span aria-hidden="true" class="text-xs">
                {store.sortKey === column.key ? (store.sortDir === "asc" ? "▲" : "▼") : "　"}
              </span>
            </button>
          </th>
        {/each}
        <th scope="col" class="{cell} font-medium">Tags</th>
        <th scope="col" class="{cell} text-right font-medium">
          <span class="sr-only">Actions</span>
        </th>
      </tr>
    </thead>

    <tbody>
      {#each items as bookmark, i (bookmark.id)}
        <tr
          data-bm-index={i}
          class="border-b border-[var(--color-border)] {bookmark.archived ? 'opacity-60' : ''}
                 {i === focusedIndex
            ? 'bg-[var(--color-surface-raised)] ring-2 ring-[var(--color-accent)] ring-inset'
            : ''}"
        >
          <td class={cell}>
            <div class="flex items-start gap-2">
              <SelectBox {bookmark} />
              <DomainTile url={bookmark.url} size="h-6 w-6 text-[0.6rem]" />
              <div class="min-w-0">
                {#if isSafeUrl(bookmark.url)}
                  <a
                    class="font-medium text-[var(--color-accent)] hover:underline"
                    href={bookmark.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                  >
                    {bookmark.title}
                  </a>
                {:else}
                  <!-- Deliberately not an anchor: a javascript: or data: URL must not be clickable. -->
                  <span class="font-medium">{bookmark.title}</span>
                  <span
                    class="ml-1 rounded border border-[var(--color-danger)] px-1 text-xs text-[var(--color-danger)]"
                    title="This URL uses a scheme that could run code in this page, so it has been disabled."
                  >
                    unsafe
                  </span>
                {/if}
                {#if bookmark.pinned}
                  <span class="ml-1 text-xs text-[var(--color-ink-soft)]">pinned</span>
                {/if}
                <!-- The host column is hidden on narrow screens, so it repeats here. -->
                <p class="truncate text-xs text-[var(--color-ink-soft)] md:hidden">
                  {hostOf(bookmark.url)}
                </p>
              </div>
            </div>
          </td>

          <td class="{cell} hidden text-[var(--color-ink-soft)] md:table-cell">
            {hostOf(bookmark.url)}
          </td>
          <td class="{cell} hidden whitespace-nowrap text-[var(--color-ink-soft)] lg:table-cell">
            {shortDate(bookmark.updatedAt)}
          </td>
          <td class="{cell} hidden whitespace-nowrap text-[var(--color-ink-soft)] sm:table-cell">
            {shortDate(bookmark.createdAt)}
          </td>

          <td class={cell}>
            <div class="flex flex-wrap gap-1">
              {#each bookmark.tags as tag (tag)}
                <button
                  class="rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-xs text-[var(--color-ink-soft)]"
                  onclick={() => onTag(tag)}
                >
                  {tag}
                </button>
              {/each}
            </div>
          </td>

          <td class={cell}>
            <BookmarkActions
              {bookmark}
              {onDelete}
              {onUpdate}
              compact
              onEdit={() => (store.editingId = bookmark.id)}
            />
          </td>
        </tr>

        {#if store.editingId === bookmark.id}
          <!-- The table's version of "expands full width": one spanning row beneath its own. -->
          <tr class="border-b border-[var(--color-border)] bg-[var(--color-surface-raised)]">
            <td class="px-3 py-3" colspan="6">
              <BookmarkEditForm {bookmark} {onUpdate} onClose={() => (store.editingId = null)} />
            </td>
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>
</div>
