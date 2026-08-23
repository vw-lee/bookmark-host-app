<script lang="ts">
  /**
   * One bookmark (task 1e / 1i).
   *
   * The href is gated on isSafeUrl at RENDER time, sharing the same validator the save path
   * uses (§5.4). An unsafe URL renders as inert text with a warning badge — never as an
   * anchor, whatever is in the file.
   */
  import type { Bookmark } from "../schema/types";
  import { isSafeUrl } from "../schema/normalize";

  interface Props {
    bookmark: Bookmark;
    onTag: (tag: string) => void;
    onDelete: (id: string) => void;
    onTogglePin: (id: string) => void;
  }

  const { bookmark, onTag, onDelete, onTogglePin }: Props = $props();

  const safe = $derived(isSafeUrl(bookmark.url));
  const host = $derived.by(() => {
    try {
      return new URL(bookmark.url).hostname.replace(/^www\./, "");
    } catch {
      return bookmark.url.slice(0, 40);
    }
  });
</script>

<article class="border-b border-[var(--color-border)] px-4 py-3">
  <div class="flex items-start justify-between gap-3">
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

    <div class="flex shrink-0 gap-1 text-xs">
      <button
        class="rounded px-2 py-1 text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-raised)]"
        onclick={() => onTogglePin(bookmark.id)}
        aria-label={bookmark.pinned ? "Unpin" : "Pin"}
        title={bookmark.pinned ? "Unpin" : "Pin"}
      >
        {bookmark.pinned ? "unpin" : "pin"}
      </button>
      <button
        class="rounded px-2 py-1 text-[var(--color-danger)] hover:bg-[var(--color-surface-raised)]"
        onclick={() => onDelete(bookmark.id)}
        aria-label="Delete"
      >
        delete
      </button>
    </div>
  </div>
</article>
