<script lang="ts">
  /**
   * Tag sidebar (task 1g), with an in-place filter (task 7q, D26).
   *
   * The tree is built by splitting stored tags on "/" — the ancestor nodes shown here are
   * derived, never stored on any record (§3.3.1). Each node shows the descendant-inclusive
   * total, with the exact count in the tooltip.
   *
   * The filter box narrows the tree as you type, using the palette's fuzzy scoring so the two
   * places that find a tag agree on what "matches". Ancestors of a match stay visible, dimmed
   * and italic, so the indentation keeps meaning something — italic as well as dim because on
   * e-ink soft ink IS ink (§1.2) and a colour-only cue would vanish. The logic is in
   * `tagFilter.ts`; this file only renders it.
   */
  import { store, type Scope } from "../store.svelte";
  import { filterTags } from "./tagFilter";

  interface Props {
    counts: Map<string, { exact: number; total: number }>;
    selected: string | null;
    onSelect: (tag: string | null) => void;
    totalCount: number;
    /** The filter box, bound upward so the app's `t` shortcut can focus it. */
    filterInput?: HTMLInputElement | null;
  }

  let { counts, selected, onSelect, totalCount, filterInput = $bindable(null) }: Props = $props();

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

  // Local to the sidebar on purpose: it narrows what the tree SHOWS, never which bookmarks are
  // listed. A box that quietly filtered the list too would be a second search field with
  // different rules, and one left non-empty by accident would look like missing data.
  let filter = $state("");

  const sortedTags = $derived([...counts.keys()].sort((a, b) => a.localeCompare(b)));
  const filtered = $derived(filterTags(sortedTags, filter));

  const nodes = $derived(
    filtered.nodes.map(({ tag, match }) => ({
      tag,
      match,
      count: counts.get(tag) ?? { exact: 0, total: 0 },
      depth: tag.split("/").length - 1,
      leaf: tag.split("/").at(-1) ?? tag,
    })),
  );

  function onFilterKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      // The best-scoring match, which the tree marks with ↵ so this is never a surprise.
      if (filtered.best !== null) {
        event.preventDefault();
        onSelect(filtered.best);
      }
      return;
    }
    if (event.key === "Escape") {
      // Escape here is about this box: clear it, or leave it when already empty. Stopped so
      // the app-level Escape does not also drop the user's selection.
      event.preventDefault();
      event.stopPropagation();
      if (filter) filter = "";
      else filterInput?.blur();
    }
  }
</script>

<!--
  The sidebar scrolls on its own (D18), and "All" is pinned above that scroll rather than
  riding it. A deep tag tree can run to hundreds of nodes, and "show me everything again" is
  the one control you reach for after scrolling far enough to lose sight of it. The filter box
  is pinned for the same reason: it is how you get back from "hundreds of nodes".

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

  {#if sortedTags.length === 0}
    <p class="mt-3 px-2 text-xs text-[var(--color-ink-soft)]">
      No tags yet. Add one when saving a bookmark — use <code>parent/child</code> for nesting.
    </p>
  {:else}
    <div class="relative mt-1 shrink-0">
      <input
        bind:this={filterInput}
        bind:value={filter}
        class="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 pr-7 text-sm"
        placeholder="Filter tags  (t)"
        aria-label="Filter tags"
        autocomplete="off"
        onkeydown={onFilterKeydown}
      />
      {#if filter}
        <button
          class="absolute inset-y-0 right-0 px-2 text-[var(--color-ink-soft)]"
          aria-label="Clear tag filter"
          title="Clear (Esc)"
          onclick={() => {
            filter = "";
            filterInput?.focus();
          }}
        >
          ×
        </button>
      {/if}
    </div>

    {#if nodes.length === 0}
      <p class="mt-3 px-2 text-xs text-[var(--color-ink-soft)]">No tags match “{filter}”.</p>
    {/if}
  {/if}

  <ul class="bm-scroll mt-1 min-h-0 flex-1" aria-label="Tags">
    {#each nodes as node (node.tag)}
      <li>
        <button
          class="flex w-full items-center justify-between gap-1 rounded px-2 py-1 text-left {selected ===
          node.tag
            ? 'bg-[var(--color-surface-raised)] font-medium'
            : ''} {node.match ? '' : 'italic text-[var(--color-ink-soft)]'}"
          style="padding-left: {0.5 + node.depth * 0.75}rem"
          onclick={() => onSelect(node.tag)}
          title="{node.count.exact} tagged exactly {node.tag}, {node.count.total} including nested{node.match
            ? ''
            : ' — shown as the parent of a match'}"
          data-tag-match={node.match}
        >
          <span class="truncate">{node.leaf}</span>
          <span class="shrink-0 text-[var(--color-ink-soft)]">
            {#if filter && filtered.best === node.tag}
              <span aria-hidden="true" title="Enter selects this">↵</span>
            {/if}
            {node.count.total}
          </span>
        </button>
      </li>
    {/each}
  </ul>
</nav>
