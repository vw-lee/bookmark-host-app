<script lang="ts">
  /**
   * One bookmark as a boxed card (task 7g).
   *
   * Editing expands the card to span every column (`col-span-full`) rather than opening a
   * dialog. The grid reflows around it, the surrounding cards stay on screen as context, and
   * the form needs no focus trap — the same reasoning that kept the row view modal-free.
   *
   * The description is clamped to three lines instead of truncated to a character count, so
   * cards in a row stay the same height without cutting a word mid-glyph.
   */
  import type { Bookmark } from "../schema/types";
  import { isSafeUrl } from "../schema/normalize";
  import { hostOf } from "./sort";
  import BookmarkEditForm from "./BookmarkEditForm.svelte";
  import BookmarkActions from "./BookmarkActions.svelte";
  import DomainTile from "./DomainTile.svelte";

  interface Props {
    bookmark: Bookmark;
    onTag: (tag: string) => void;
    onDelete: (id: string) => void;
    onUpdate: (id: string, patch: Partial<Bookmark>) => void;
  }

  const { bookmark, onTag, onDelete, onUpdate }: Props = $props();

  let editing = $state(false);

  const safe = $derived(isSafeUrl(bookmark.url));
  const host = $derived(hostOf(bookmark.url));
</script>

<article
  role="listitem"
  class="flex flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3
         {bookmark.archived ? 'opacity-60' : ''} {editing ? 'col-span-full' : ''}"
>
  {#if editing}
    <BookmarkEditForm {bookmark} {onUpdate} onClose={() => (editing = false)} />
  {:else}
    <div class="flex items-start gap-2">
      <DomainTile url={bookmark.url} />
      <div class="min-w-0 flex-1">
        {#if safe}
          <a
            class="line-clamp-2 font-medium text-[var(--color-accent)] hover:underline"
            href={bookmark.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            {bookmark.title}
          </a>
        {:else}
          <!-- Deliberately not an anchor: a javascript: or data: URL must not be clickable. -->
          <span class="line-clamp-2 font-medium">{bookmark.title}</span>
          <span
            class="mt-1 inline-block rounded border border-[var(--color-danger)] px-1.5 py-0.5 text-xs text-[var(--color-danger)]"
            title="This URL uses a scheme that could run code in this page, so it has been disabled."
          >
            unsafe link
          </span>
        {/if}
        <p class="truncate text-xs text-[var(--color-ink-soft)]">{host}</p>
      </div>
    </div>

    {#if bookmark.pinned || bookmark.archived}
      <p class="mt-1 text-xs text-[var(--color-ink-soft)]">
        {bookmark.pinned ? "pinned" : ""}{bookmark.pinned && bookmark.archived ? " · " : ""}{bookmark.archived
          ? "archived"
          : ""}
      </p>
    {/if}

    {#if bookmark.description}
      <p class="mt-2 line-clamp-3 text-sm text-[var(--color-ink-soft)]">{bookmark.description}</p>
    {/if}

    {#if bookmark.tags.length > 0}
      <div class="mt-2 flex flex-wrap gap-1.5">
        {#each bookmark.tags as tag (tag)}
          <button
            class="max-w-full truncate rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-xs text-[var(--color-ink-soft)]"
            onclick={() => onTag(tag)}
          >
            {tag}
          </button>
        {/each}
      </div>
    {/if}

    <!-- mt-auto pins the actions to the bottom so they line up across a row of uneven cards. -->
    <div class="mt-auto pt-3">
      <BookmarkActions {bookmark} {onDelete} {onUpdate} onEdit={() => (editing = true)} />
    </div>
  {/if}
</article>
