<script lang="ts">
  /**
   * Tag sidebar (task 1g).
   *
   * The tree is built by splitting stored tags on "/" — the ancestor nodes shown here are
   * derived, never stored on any record (§3.3.1). Each node shows the descendant-inclusive
   * total, with the exact count in the tooltip.
   */
  interface Props {
    counts: Map<string, { exact: number; total: number }>;
    selected: string | null;
    onSelect: (tag: string | null) => void;
    totalCount: number;
  }

  const { counts, selected, onSelect, totalCount }: Props = $props();

  const nodes = $derived(
    [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tag, count]) => ({
        tag,
        count,
        depth: tag.split("/").length - 1,
        leaf: tag.split("/").at(-1) ?? tag,
      })),
  );
</script>

<nav class="w-56 shrink-0 border-r border-[var(--color-border)] p-3 text-sm">
  <button
    class="w-full rounded px-2 py-1 text-left {selected === null
      ? 'bg-[var(--color-surface-raised)] font-medium'
      : ''}"
    onclick={() => onSelect(null)}
  >
    All <span class="text-[var(--color-ink-soft)]">{totalCount}</span>
  </button>

  {#if nodes.length === 0}
    <p class="mt-3 px-2 text-xs text-[var(--color-ink-soft)]">
      No tags yet. Add one when saving a bookmark — use <code>parent/child</code> for nesting.
    </p>
  {/if}

  <ul class="mt-1">
    {#each nodes as node (node.tag)}
      <li>
        <button
          class="w-full rounded px-2 py-1 text-left {selected === node.tag
            ? 'bg-[var(--color-surface-raised)] font-medium'
            : ''}"
          style="padding-left: {0.5 + node.depth * 0.75}rem"
          onclick={() => onSelect(node.tag)}
          title="{node.count.exact} tagged exactly {node.tag}, {node.count.total} including nested"
        >
          {node.leaf}
          <span class="text-[var(--color-ink-soft)]">{node.count.total}</span>
        </button>
      </li>
    {/each}
  </ul>
</nav>
