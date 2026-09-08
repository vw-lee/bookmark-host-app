<script lang="ts">
  /**
   * One bookmark as a full-width row — the default view (tasks 1e, 1i, 2b).
   *
   * The href is gated on isSafeUrl at RENDER time, sharing the same validator the save path
   * uses (§5.4). An unsafe URL renders as inert text with a warning badge — never as an
   * anchor, whatever is in the file.
   *
   * The edit form and the action buttons moved to shared components when the card and table
   * views arrived (7g); the layout here is unchanged.
   */
  import type { Bookmark } from "../schema/types";
  import { isSafeUrl } from "../schema/normalize";
  import { hostOf } from "./sort";
  import BookmarkEditForm from "./BookmarkEditForm.svelte";
  import BookmarkActions from "./BookmarkActions.svelte";
  import DomainTile from "./DomainTile.svelte";
  import SelectBox from "./SelectBox.svelte";
  import { store } from "../store.svelte";

  interface Props {
    bookmark: Bookmark;
    onTag: (tag: string) => void;
    onDelete: (id: string) => void;
    onUpdate: (id: string, patch: Partial<Bookmark>) => void;
    /** Position on the current page, so the keyboard cursor can find this row (task 7m). */
    index?: number;
    focused?: boolean;
  }

  const { bookmark, onTag, onDelete, onUpdate, index, focused = false }: Props = $props();

  const editing = $derived(store.editingId === bookmark.id);

  const safe = $derived(isSafeUrl(bookmark.url));
  const host = $derived(hostOf(bookmark.url));
</script>

<article
  data-bm-index={index}
  class="border-b border-[var(--color-border)] px-4 py-3 {bookmark.archived ? 'opacity-60' : ''}
         {focused ? 'bg-[var(--color-surface-raised)] ring-2 ring-[var(--color-accent)] ring-inset' : ''}"
>
  {#if editing}
    <BookmarkEditForm {bookmark} {onUpdate} onClose={() => (store.editingId = null)} />
  {:else}
    <div class="flex items-start gap-3">
      <SelectBox {bookmark} />
      <DomainTile url={bookmark.url} />

      <div class="min-w-0 flex-1">
        {#if safe}
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
            class="ml-2 rounded border border-[var(--color-danger)] px-1.5 py-0.5 text-xs text-[var(--color-danger)]"
            title="This URL uses a scheme that could run code in this page, so it has been disabled."
          >
            unsafe link
          </span>
        {/if}

        {#if bookmark.pinned}
          <span class="ml-2 text-xs text-[var(--color-ink-soft)]">pinned</span>
        {/if}
        {#if bookmark.archived}
          <span class="ml-2 text-xs text-[var(--color-ink-soft)]">archived</span>
        {/if}

        <p class="truncate text-xs text-[var(--color-ink-soft)]">{host}</p>

        {#if bookmark.description}
          <p class="mt-1 text-sm text-[var(--color-ink-soft)]">{bookmark.description}</p>
        {/if}

        {#if bookmark.tags.length > 0}
          <div class="mt-2 flex flex-wrap gap-1.5">
            {#each bookmark.tags as tag (tag)}
              <button
                class="rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-0.5 text-xs text-[var(--color-ink-soft)]"
                onclick={() => onTag(tag)}
              >
                {tag}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <BookmarkActions {bookmark} {onDelete} {onUpdate} onEdit={() => (store.editingId = bookmark.id)} />
    </div>
  {/if}
</article>
