<script lang="ts">
  /**
   * Undo (task 7j).
   *
   * Delete used to be silent and final-feeling: a tombstone written on the spot, committed
   * three seconds later, with no acknowledgement that anything had happened. The record was
   * always recoverable — merge.ts keeps tombstones for 90 days — but nothing in the app said
   * so at the moment it mattered.
   *
   * The offer outlives the write debounce on purpose (UNDO_WINDOW_MS). Undoing after the
   * commit simply writes the previous state back as another commit, which is what a git-backed
   * store makes cheap.
   *
   * `aria-live="assertive"` rather than "polite": a destructive action that a screen reader
   * announces only after the offer has expired is not an offer.
   */
  import { store } from "../store.svelte";
</script>

{#if store.undoable}
  <div
    class="fixed inset-x-0 bottom-4 z-60 flex justify-center px-4"
    role="status"
    aria-live="assertive"
  >
    <div
      class="flex items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm shadow-lg"
    >
      <span>{store.undoable.label}</span>
      <button
        class="font-medium text-[var(--color-accent)] underline"
        onclick={() => store.undo()}
      >
        Undo
      </button>
      <button
        class="text-xs text-[var(--color-ink-soft)] underline"
        onclick={() => store.dismissUndo()}
        aria-label="Dismiss"
      >
        dismiss
      </button>
    </div>
  </div>
{/if}
