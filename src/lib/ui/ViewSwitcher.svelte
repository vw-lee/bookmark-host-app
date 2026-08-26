<script lang="ts">
  /**
   * The view mode segmented control (task 7g).
   *
   * A visible row of four buttons rather than a dropdown: it shows every option and its current
   * state in one glance, needs no popup layer, and gives e-ink four large static hit targets
   * instead of a menu that reflows after paint (§1.2).
   *
   * `aria-pressed` rather than a radiogroup — these are toggle buttons that act immediately, and
   * a radiogroup would promise arrow-key semantics that a four-item toolbar does not need.
   */
  import { view, VIEW_MODES, VIEW_LABELS } from "./viewMode.svelte";
</script>

<div class="flex items-center gap-0.5 rounded border border-[var(--color-border)] p-0.5" role="group" aria-label="View mode">
  {#each VIEW_MODES as mode (mode)}
    <button
      class="rounded px-2 py-1 text-xs
             {view.current === mode
        ? 'bg-[var(--color-accent)] font-medium text-white'
        : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-raised)]'}"
      aria-pressed={view.current === mode}
      onclick={() => view.set(mode)}
    >
      {VIEW_LABELS[mode]}
    </button>
  {/each}
</div>
