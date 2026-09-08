<script lang="ts">
  /**
   * Bulk actions on a selection (task 7k).
   *
   * BulkTools already handled operations on the whole collection — dedupe, rename a tag, delete
   * a tag. What was missing is the operation people actually need after importing 300 browser
   * bookmarks: pick some of them and tag them together. That was 300 individual edits.
   *
   * "Select all N matching" is the load-bearing control here, not a convenience. Selection that
   * stopped at the page boundary would mean six rounds of fifty for a single import, which is
   * exactly the tedium the feature exists to remove.
   *
   * Every operation goes through `store.selectedVisible`, so a selection made before a filter
   * changed can never act on records the user can no longer see.
   */
  import { store } from "../store.svelte";
  import TagVocabulary from "./TagVocabulary.svelte";

  let tagInput = $state("");
  let mode = $state<"add" | "remove">("add");
  let confirmingDelete = $state(false);

  const count = $derived(store.selectedVisible.length);
  const matching = $derived(store.visible.length);
  const allMatchingSelected = $derived(count > 0 && count === matching);

  function ids(): string[] {
    return store.selectedVisible.map((b) => b.id);
  }

  function applyTags() {
    const tags = tagInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length === 0) return;

    if (mode === "add") store.addTags(ids(), tags);
    else store.removeTags(ids(), tags);
    tagInput = "";
  }

  function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    applyTags();
  }
</script>

{#if count > 0}
  <div
    class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--color-accent)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm"
    role="region"
    aria-label="Bulk actions"
  >
    <span class="font-medium">{count} selected</span>

    <button class="underline" onclick={() => store.selectPage()}>Select page</button>
    {#if !allMatchingSelected && matching > count}
      <button class="underline" onclick={() => store.selectAllMatching()}>
        Select all {matching} matching
      </button>
    {/if}
    <button class="underline" onclick={() => store.clearSelection()}>Clear</button>

    <form class="flex flex-wrap items-center gap-2" onsubmit={onSubmit}>
      <select
        bind:value={mode}
        class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
        aria-label="Add or remove tags"
      >
        <option value="add">Add tags</option>
        <option value="remove">Remove tags</option>
      </select>

      <input
        bind:value={tagInput}
        list="bm-tags-bulk"
        class="w-56 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
        placeholder="dev/rust, reading-list"
        aria-label="Tags, comma separated"
      />
      <TagVocabulary id="bm-tags-bulk" />

      <button
        class="rounded bg-[var(--color-accent)] px-3 py-1 font-medium text-white disabled:opacity-50"
        type="submit"
        disabled={tagInput.trim() === ""}
      >
        Apply
      </button>
    </form>

    {#if store.scope === "trash"}
      <button class="underline" onclick={() => store.restoreMany(ids())}>Restore</button>
    {:else}
      <button class="underline" onclick={() => store.setArchived(ids(), store.scope !== "archived")}>
        {store.scope === "archived" ? "Unarchive" : "Archive"}
      </button>
      <button class="underline" onclick={() => store.setPinned(ids(), true)}>Pin</button>

      <!-- Confirmed, unlike the single-row delete: undo covers a slip, but a slip that took 200
           records with it deserves a moment's pause first. -->
      {#if confirmingDelete}
        <button
          class="font-medium text-[var(--color-danger)] underline"
          onclick={() => {
            store.deleteMany(ids());
            confirmingDelete = false;
          }}
        >
          Delete {count}?
        </button>
        <button class="underline" onclick={() => (confirmingDelete = false)}>Cancel</button>
      {:else}
        <button
          class="text-[var(--color-danger)] underline"
          onclick={() => (confirmingDelete = true)}
        >
          Delete
        </button>
      {/if}
    {/if}
  </div>
{/if}
