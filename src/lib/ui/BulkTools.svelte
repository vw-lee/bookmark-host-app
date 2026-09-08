<script lang="ts">
  /**
   * Bulk dedupe and tag operations (tasks 4e, 4f).
   *
   * Everything here previews before it applies. Dedupe and the single tag operations rewrite
   * hundreds of records at once and cannot be undone from inside the app — though because the
   * store is git, the previous state is always one revert away in the repository. Batch rename
   * (7p) is the exception: it takes an undo entry, because it is the one people run a dozen
   * rules through at once, straight after an import.
   */
  import { store } from "../store.svelte";
  import { planRename, planDeleteTag, type TagPlan } from "../io/bulk";
  import BatchTagRename from "./BatchTagRename.svelte";

  interface Props {
    onClose: () => void;
  }
  const { onClose }: Props = $props();

  let renameFrom = $state("");
  let renameTo = $state("");
  let deleteTarget = $state("");
  let done = $state<string | null>(null);

  const duplicates = $derived(store.duplicates);
  const allTags = $derived([...store.tagCounts.keys()].sort());

  const renamePlan = $derived<TagPlan | null>(
    renameFrom && renameTo ? planRename(store.file.bookmarks, renameFrom, renameTo) : null,
  );
  const deletePlan = $derived<TagPlan | null>(
    deleteTarget ? planDeleteTag(store.file.bookmarks, deleteTarget) : null,
  );

  function mergeAll() {
    const merged = store.mergeDuplicates(duplicates);
    done = `Merged ${merged} duplicate${merged === 1 ? "" : "s"}.`;
  }

  function doRename() {
    store.renameTag(renameFrom, renameTo);
    done = `Renamed ${renameFrom} to ${renameTo}.`;
    renameFrom = "";
    renameTo = "";
  }

  function doDelete() {
    const tag = deleteTarget;
    store.deleteTag(tag);
    done = `Removed the tag ${tag}. No bookmarks were deleted.`;
    deleteTarget = "";
  }
</script>

<div class="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-16">
  <div
    class="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
  >
    <div class="flex items-center justify-between">
      <h2 class="font-semibold">Bulk tools</h2>
      <button class="text-sm underline" onclick={onClose}>Close</button>
    </div>

    {#if done}
      <p class="mt-3 rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm">
        {done}
      </p>
    {/if}

    <section class="mt-5">
      <h3 class="text-sm font-medium">Duplicates</h3>
      {#if duplicates.length === 0}
        <p class="mt-1 text-sm text-[var(--color-ink-soft)]">
          No duplicates. Links are deduplicated as they are added, so this should stay empty
          unless you import from several sources.
        </p>
      {:else}
        <p class="mt-1 text-sm text-[var(--color-ink-soft)]">
          {duplicates.length} link{duplicates.length === 1 ? "" : "s"} saved more than once. The
          oldest copy is kept, its original date preserved, and every tag and the longest
          description are merged into it.
        </p>
        <ul class="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-[var(--color-ink-soft)]">
          {#each duplicates.slice(0, 20) as group (group.urlKey)}
            <li class="truncate">
              {group.urlKey} — {group.merge.length + 1} copies → tags {group.mergedTags.join(", ") ||
                "none"}
            </li>
          {/each}
        </ul>
        <button
          class="mt-2 rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
          onclick={mergeAll}
        >
          Merge all {duplicates.length}
        </button>
      {/if}
    </section>

    <section class="mt-6 border-t border-[var(--color-border)] pt-4">
      <h3 class="text-sm font-medium">Rename a tag</h3>
      <p class="mt-1 text-sm text-[var(--color-ink-soft)]">
        Renaming carries everything nested beneath it — renaming <code>dev</code> also moves
        <code>dev/rust</code>.
      </p>
      <div class="mt-2 flex gap-2">
        <input
          bind:value={renameFrom}
          list="tag-list"
          placeholder="from"
          class="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 text-sm"
        />
        <input
          bind:value={renameTo}
          placeholder="to"
          class="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 text-sm"
        />
      </div>

      {#if renamePlan && renamePlan.affected > 0}
        <div class="mt-2 rounded border border-[var(--color-border)] p-2 text-xs">
          <p>{renamePlan.affected} bookmark{renamePlan.affected === 1 ? "" : "s"} affected:</p>
          <ul class="mt-1 text-[var(--color-ink-soft)]">
            {#each renamePlan.examples as example (example.from)}
              <li><code>{example.from}</code> → <code>{example.to}</code></li>
            {/each}
          </ul>
          {#if renamePlan.collisions.length > 0}
            <p class="mt-1 text-[var(--color-danger)]">
              Merges into existing tag{renamePlan.collisions.length === 1 ? "" : "s"}:
              {renamePlan.collisions.join(", ")}
            </p>
          {/if}
        </div>
        <button
          class="mt-2 rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
          onclick={doRename}
        >
          Rename
        </button>
      {:else if renameFrom && renameTo}
        <p class="mt-2 text-xs text-[var(--color-ink-soft)]">Nothing matches that tag.</p>
      {/if}
    </section>

    <BatchTagRename onDone={(message) => (done = message)} />

    <section class="mt-6 border-t border-[var(--color-border)] pt-4">
      <h3 class="text-sm font-medium">Remove a tag</h3>
      <p class="mt-1 text-sm text-[var(--color-ink-soft)]">
        Removes the tag and everything nested beneath it. <strong>Bookmarks are never
        deleted</strong> — only the tag is taken off them.
      </p>
      <input
        bind:value={deleteTarget}
        list="tag-list"
        placeholder="tag"
        class="mt-2 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 text-sm"
      />
      {#if deletePlan && deletePlan.affected > 0}
        <p class="mt-2 text-xs text-[var(--color-ink-soft)]">
          Removes it from {deletePlan.affected} bookmark{deletePlan.affected === 1 ? "" : "s"}.
        </p>
        <button
          class="mt-2 rounded border border-[var(--color-danger)] px-3 py-1.5 text-sm text-[var(--color-danger)]"
          onclick={doDelete}
        >
          Remove tag
        </button>
      {/if}
    </section>

    <datalist id="tag-list">
      {#each allTags as tag (tag)}
        <option value={tag}></option>
      {/each}
    </datalist>
  </div>
</div>
