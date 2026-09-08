<script lang="ts">
  /**
   * The inline edit form, shared by every view mode (tasks 2b, 7g).
   *
   * Extracted from BookmarkRow when cards arrived. Two copies of a form that validates URLs and
   * splits tags is two places for those rules to drift, and the URL check here is a security
   * boundary (§5.4) rather than a convenience — it is not something to have a second, slightly
   * different version of.
   *
   * It stays an expand-in-place form rather than a modal in every mode. A dialog would need a
   * focus trap, and unwinding a focus trap for keyboard and e-ink use is exactly the cost the
   * original row form was written to avoid.
   */
  import type { Bookmark } from "../schema/types";
  import { isSafeUrl } from "../schema/normalize";
  import TagVocabulary from "./TagVocabulary.svelte";

  interface Props {
    bookmark: Bookmark;
    onUpdate: (id: string, patch: Partial<Bookmark>) => void;
    onClose: () => void;
  }

  const { bookmark, onUpdate, onClose }: Props = $props();

  let problem = $state<string | null>(null);

  /**
   * Seeded from the record once, so cancelling truly discards rather than half-applying.
   *
   * Capturing the initial value is the point, not an oversight: the form is mounted when
   * editing opens and destroyed when it closes, and a draft that re-seeded itself when a
   * background sync touched the record would erase what the user was typing.
   */
  // svelte-ignore state_referenced_locally
  let draftTitle = $state(bookmark.title);
  // svelte-ignore state_referenced_locally
  let draftUrl = $state(bookmark.url);
  // svelte-ignore state_referenced_locally
  let draftDescription = $state(bookmark.description);
  // svelte-ignore state_referenced_locally
  let draftTags = $state(bookmark.tags.join(", "));

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
    onClose();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      // Stopped so the palette and any surrounding handler do not also react to this Escape.
      event.stopPropagation();
      onClose();
    }
  }

  const field =
    "mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1";
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form class="space-y-2" onsubmit={save} onkeydown={onKeydown}>
  <label class="block text-sm">
    <span class="text-[var(--color-ink-soft)]">Title</span>
    <!-- svelte-ignore a11y_autofocus -->
    <input bind:value={draftTitle} class={field} autocomplete="off" autofocus />
  </label>

  <label class="block text-sm">
    <span class="text-[var(--color-ink-soft)]">URL</span>
    <input bind:value={draftUrl} class={field} autocomplete="off" spellcheck="false" />
  </label>

  <label class="block text-sm">
    <span class="text-[var(--color-ink-soft)]">Description</span>
    <textarea bind:value={draftDescription} rows="2" class={field}></textarea>
  </label>

  <label class="block text-sm">
    <span class="text-[var(--color-ink-soft)]">Tags <em>(comma separated)</em></span>
    <input
      bind:value={draftTags}
      list="bm-tags-edit"
      class={field}
      placeholder="dev/rust, reading-list"
      autocomplete="off"
    />
    <TagVocabulary id="bm-tags-edit" />
  </label>

  {#if problem}
    <p class="text-sm text-[var(--color-danger)]">{problem}</p>
  {/if}

  <div class="flex justify-end gap-2 text-sm">
    <button type="button" class="rounded px-3 py-1" onclick={onClose}>Cancel</button>
    <button type="submit" class="rounded bg-[var(--color-accent)] px-3 py-1 font-medium text-white">
      Save
    </button>
  </div>
</form>
