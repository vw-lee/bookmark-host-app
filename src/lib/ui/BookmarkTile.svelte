<script lang="ts">
  /**
   * One bookmark as a speed-dial tile (task 7g).
   *
   * The densest mode: a launch surface rather than a management one. The whole tile is the
   * link, so the hit target is the full square rather than a line of text — which is what makes
   * this the mode that works on a phone and on a touch e-ink panel.
   *
   * Editing expands full-width exactly as a card does, so the interaction is the same wherever
   * the user learned it.
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
    onDelete: (id: string) => void;
    onUpdate: (id: string, patch: Partial<Bookmark>) => void;
    /** Position on the current page, so the keyboard cursor can find this tile (task 7m). */
    index?: number;
    focused?: boolean;
  }

  const { bookmark, onDelete, onUpdate, index, focused = false }: Props = $props();

  const editing = $derived(store.editingId === bookmark.id);

  const safe = $derived(isSafeUrl(bookmark.url));
  const host = $derived(hostOf(bookmark.url));
</script>

<article
  role="listitem"
  data-bm-index={index}
  class="relative flex flex-col items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-2 text-center
         {bookmark.archived ? 'opacity-60' : ''} {editing ? 'col-span-full items-stretch text-left' : ''}
         {focused ? 'ring-2 ring-[var(--color-accent)]' : ''}"
>
  {#if editing}
    <BookmarkEditForm {bookmark} {onUpdate} onClose={() => (store.editingId = null)} />
  {:else}
    <!-- Absolute, because a tile is 7rem wide and has no row to spare for a checkbox. -->
    <div class="absolute top-1 left-1">
      <SelectBox {bookmark} />
    </div>
    {#if safe}
      <a
        class="flex w-full flex-col items-center gap-1.5 rounded p-1 hover:bg-[var(--color-surface)]"
        href={bookmark.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        title={bookmark.title}
      >
        <DomainTile url={bookmark.url} size="h-12 w-12 text-lg" />
        <span class="line-clamp-2 w-full text-xs font-medium break-words">{bookmark.title}</span>
        <span class="w-full truncate text-[0.65rem] text-[var(--color-ink-soft)]">{host}</span>
      </a>
    {:else}
      <!-- Deliberately not an anchor: a javascript: or data: URL must not be clickable. -->
      <span class="flex w-full flex-col items-center gap-1.5 p-1">
        <DomainTile url={bookmark.url} size="h-12 w-12 text-lg" />
        <span class="line-clamp-2 w-full text-xs font-medium break-words">{bookmark.title}</span>
        <span
          class="rounded border border-[var(--color-danger)] px-1 text-[0.65rem] text-[var(--color-danger)]"
          title="This URL uses a scheme that could run code in this page, so it has been disabled."
        >
          unsafe link
        </span>
      </span>
    {/if}

    {#if bookmark.pinned}
      <span class="text-[0.65rem] text-[var(--color-ink-soft)]">pinned</span>
    {/if}

    <div class="mt-1.5">
      <BookmarkActions
        {bookmark}
        {onDelete}
        {onUpdate}
        compact
        onEdit={() => (store.editingId = bookmark.id)}
      />
    </div>
  {/if}
</article>
