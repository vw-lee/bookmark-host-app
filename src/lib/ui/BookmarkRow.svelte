<script lang="ts">
  /**
   * One bookmark, with inline editing (tasks 1e, 1i, 2b).
   *
   * The href is gated on isSafeUrl at RENDER time, sharing the same validator the save path
   * uses (§5.4). An unsafe URL renders as inert text with a warning badge — never as an
   * anchor, whatever is in the file.
   *
   * Editing expands in place rather than opening a modal: it keeps the surrounding list as
   * context, and it avoids a focus trap that would need unwinding for keyboard and e-ink use.
   */
  import type { Bookmark } from "../schema/types";
  import { isSafeUrl } from "../schema/normalize";

  interface Props {
    bookmark: Bookmark;
    onTag: (tag: string) => void;
    onDelete: (id: string) => void;
    onUpdate: (id: string, patch: Partial<Bookmark>) => void;
  }

  const { bookmark, onTag, onDelete, onUpdate }: Props = $props();

  let editing = $state(false);
  let problem = $state<string | null>(null);

  // Draft state, seeded when editing opens so cancelling truly discards.
  let draftTitle = $state("");
  let draftUrl = $state("");
  let draftDescription = $state("");
  let draftTags = $state("");

  const safe = $derived(isSafeUrl(bookmark.url));
  const host = $derived.by(() => {
    try {
      return new URL(bookmark.url).hostname.replace(/^www\./, "");
    } catch {
      return bookmark.url.slice(0, 40);
    }
  });

  function startEdit() {
    draftTitle = bookmark.title;
    draftUrl = bookmark.url;
    draftDescription = bookmark.description;
    draftTags = bookmark.tags.join(", ");
    problem = null;
    editing = true;
  }

  function save(event: SubmitEvent) {
    event.preventDefault();
    const url = draftUrl.trim();
    if (!isSafeUrl(url)) {
      problem = "Only http and https links can be saved.";
      return;
    }
    onUpdate(bookmark.id, {
      title: draftTitle.trim(),
      url,
      description: draftDescription.trim(),
      tags: draftTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
    editing = false;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      editing = false;
    }
  }
</script>

<article
  class="border-b border-[var(--color-border)] px-4 py-3 {bookmark.archived ? 'opacity-60' : ''}"
>
  {#if editing}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <form class="space-y-2" onsubmit={save} onkeydown={onKeydown}>
      <label class="block text-sm">
        <span class="text-[var(--color-ink-soft)]">Title</span>
        <input
          bind:value={draftTitle}
          class="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1"
          autocomplete="off"
        />
      </label>

      <label class="block text-sm">
        <span class="text-[var(--color-ink-soft)]">URL</span>
        <input
          bind:value={draftUrl}
          class="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1"
          autocomplete="off"
          spellcheck="false"
        />
      </label>

      <label class="block text-sm">
        <span class="text-[var(--color-ink-soft)]">Description</span>
        <textarea
          bind:value={draftDescription}
          rows="2"
          class="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1"
        ></textarea>
      </label>

      <label class="block text-sm">
        <span class="text-[var(--color-ink-soft)]">Tags <em>(comma separated)</em></span>
        <input
          bind:value={draftTags}
          class="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1"
          placeholder="dev/rust, reading-list"
          autocomplete="off"
        />
      </label>

      {#if problem}
        <p class="text-sm text-[var(--color-danger)]">{problem}</p>
      {/if}

      <div class="flex justify-end gap-2 text-sm">
        <button type="button" class="rounded px-3 py-1" onclick={() => (editing = false)}>
          Cancel
        </button>
        <button
          type="submit"
          class="rounded bg-[var(--color-accent)] px-3 py-1 font-medium text-white"
        >
          Save
        </button>
      </div>
    </form>
  {:else}
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

      <div class="flex shrink-0 flex-wrap justify-end gap-1 text-xs">
        <button
          class="rounded px-2 py-1 text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-raised)]"
          onclick={startEdit}
        >
          edit
        </button>
        <button
          class="rounded px-2 py-1 text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-raised)]"
          onclick={() => onUpdate(bookmark.id, { pinned: !bookmark.pinned })}
        >
          {bookmark.pinned ? "unpin" : "pin"}
        </button>
        <button
          class="rounded px-2 py-1 text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-raised)]"
          onclick={() => onUpdate(bookmark.id, { archived: !bookmark.archived })}
        >
          {bookmark.archived ? "restore" : "archive"}
        </button>
        <button
          class="rounded px-2 py-1 text-[var(--color-danger)] hover:bg-[var(--color-surface-raised)]"
          onclick={() => onDelete(bookmark.id)}
        >
          delete
        </button>
      </div>
    </div>
  {/if}
</article>
