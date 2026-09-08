<script lang="ts">
  /**
   * Tag sidebar (task 1g).
   *
   * The tree is built by splitting stored tags on "/" — the ancestor nodes shown here are
   * derived, never stored on any record (§3.3.1). Each node shows the descendant-inclusive
   * total, with the exact count in the tooltip.
   */
  import { store, type Scope } from "../store.svelte";

  interface Props {
    counts: Map<string, { exact: number; total: number }>;
    selected: string | null;
    onSelect: (tag: string | null) => void;
    totalCount: number;
  }

  const { counts, selected, onSelect, totalCount }: Props = $props();

  /**
   * Scope selection lives here rather than in the header (task 7i).
   *
   * "What am I looking at" and "narrowed to which tag" are the same question asked at two
   * levels, so they belong in the same control. It also gets three states out of a header that
   * was already wrapping to a second row.
   */
  const scopes: { id: Scope; label: string }[] = [
    { id: "active", label: "Active" },
    { id: "archived", label: "Archived" },
    { id: "trash", label: "Trash" },
  ];

  function chooseScope(scope: Scope) {
    store.scope = scope;
    // A tag that exists in one pile may not exist in another, and a filter that silently
    // matches nothing reads as an empty collection rather than as an active filter.
    onSelect(null);
    store.clearSelection();
  }

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

<!--
  The sidebar scrolls on its own (D18), and "All" is pinned above that scroll rather than
  riding it. A deep tag tree can run to hundreds of nodes, and "show me everything again" is
  the one control you reach for after scrolling far enough to lose sight of it.

  Narrower on small screens: at w-56 a phone gives up most of its width to tags.
-->
<nav
  class="flex w-44 shrink-0 flex-col border-r border-[var(--color-border)] p-3 text-sm sm:w-56"
>
  <ul class="shrink-0">
    {#each scopes as item (item.id)}
      <li>
        <button
          class="flex w-full items-center justify-between rounded px-2 py-1 text-left {store.scope ===
          item.id
            ? 'bg-[var(--color-surface-raised)] font-medium'
            : ''}"
          aria-pressed={store.scope === item.id}
          onclick={() => chooseScope(item.id)}
        >
          <span>{item.label}</span>
          <span class="text-[var(--color-ink-soft)]">{store.scopeCounts[item.id]}</span>
        </button>
      </li>
    {/each}
  </ul>

  {#if store.scope === "trash"}
    <p class="mt-2 shrink-0 rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-ink-soft)]">
      Removed automatically 90 days after deletion. They stay in the repository's history either
      way (§5.3).
    </p>
  {/if}

  <hr class="my-2 shrink-0 border-[var(--color-border)]" />

  <button
    class="w-full shrink-0 rounded px-2 py-1 text-left {selected === null
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

  <ul class="bm-scroll mt-1 min-h-0 flex-1" aria-label="Tags">
    {#each nodes as node (node.tag)}
      <li>
        <button
          class="w-full truncate rounded px-2 py-1 text-left {selected === node.tag
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
