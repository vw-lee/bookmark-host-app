<script lang="ts">
  /**
   * Command palette (task 7a).
   *
   * Everything reachable from one keystroke: add, search, jump to a bookmark, filter by tag,
   * open any panel. Full keyboard control is also what makes the app usable on e-ink, where
   * pointing is slow and hover does not exist (§1.2).
   */
  import { store } from "../store.svelte";
  import { rank, type Command } from "./palette";
  import { liveBookmarks } from "../sync/merge";
  import { isSafeUrl } from "../schema/normalize";

  interface Props {
    onClose: () => void;
    onAdd: () => void;
    onImport: () => void;
    onTools: () => void;
    onSettings: () => void;
  }
  const { onClose, onAdd, onImport, onTools, onSettings }: Props = $props();

  let query = $state("");
  let selected = $state(0);
  let field = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLUListElement | null>(null);

  $effect(() => {
    field?.focus();
  });

  const commands = $derived.by<Command[]>(() => {
    const actions: Command[] = [
      { id: "add", kind: "action", label: "Add bookmark", detail: "Ctrl+K", run: onAdd },
      {
        id: "archived",
        kind: "action",
        label: store.showArchived ? "Hide archived" : "Show archived",
        run: () => (store.showArchived = !store.showArchived),
      },
      { id: "import", kind: "action", label: "Import and export", run: onImport },
      { id: "tools", kind: "action", label: "Bulk tools", keywords: "duplicates rename tag", run: onTools },
      { id: "settings", kind: "action", label: "Settings", keywords: "theme passphrase sync", run: onSettings },
      {
        id: "clear",
        kind: "action",
        label: "Clear filters",
        run: () => {
          store.query = "";
          store.selectedTag = null;
        },
      },
      { id: "sync", kind: "action", label: "Sync now", run: () => store.flushNow() },
    ];

    const tags: Command[] = [...store.tagCounts.entries()].map(([tag, count]) => ({
      id: `tag:${tag}`,
      kind: "tag",
      label: tag,
      detail: `${count.total} bookmark${count.total === 1 ? "" : "s"}`,
      run: () => (store.selectedTag = tag),
    }));

    const bookmarks: Command[] = liveBookmarks(store.file)
      .filter((b) => store.showArchived || !b.archived)
      .map((b) => ({
        id: `bm:${b.id}`,
        kind: "bookmark",
        label: b.title,
        detail: b.url,
        keywords: b.tags.join(" "),
        run: () => {
          // Same render-time gate as the list (§5.4): never open an unsafe scheme.
          if (isSafeUrl(b.url)) window.open(b.url, "_blank", "noopener,noreferrer");
        },
      }));

    return [...actions, ...tags, ...bookmarks];
  });

  const results = $derived(rank(commands, query));

  // A shrinking result list must not leave the cursor past the end.
  $effect(() => {
    if (selected >= results.length) selected = Math.max(0, results.length - 1);
  });

  function choose(index: number) {
    const hit = results[index];
    if (!hit) return;
    hit.command.run();
    onClose();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
      event.preventDefault();
      selected = Math.min(selected + 1, results.length - 1);
      scrollToSelected();
    } else if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
      event.preventDefault();
      selected = Math.max(selected - 1, 0);
      scrollToSelected();
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(selected);
    }
  }

  function scrollToSelected() {
    // Keep the cursor visible without animating — e-ink smears on smooth scroll (§1.2).
    listEl?.children[selected]?.scrollIntoView({ block: "nearest" });
  }
</script>

<div class="fixed inset-0 z-60 flex items-start justify-center bg-black/40 px-4 pt-20">
  <div
    class="w-full max-w-xl overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
    role="dialog"
    aria-modal="true"
    aria-label="Command palette"
  >
    <input
      bind:this={field}
      bind:value={query}
      onkeydown={onKeydown}
      oninput={() => (selected = 0)}
      class="w-full border-b border-[var(--color-border)] bg-transparent px-4 py-3 outline-none"
      placeholder="Search bookmarks, tags, and commands…"
      aria-label="Command palette search"
      aria-controls="palette-results"
      autocomplete="off"
      spellcheck="false"
    />

    {#if results.length === 0}
      <p class="px-4 py-6 text-sm text-[var(--color-ink-soft)]">Nothing matches.</p>
    {:else}
      <ul
        bind:this={listEl}
        id="palette-results"
        class="max-h-80 overflow-y-auto"
        role="listbox"
        aria-label="Results"
      >
        {#each results as hit, index (hit.command.id)}
          <li>
            <button
              class="flex w-full items-baseline gap-3 px-4 py-2 text-left text-sm {index === selected
                ? 'bg-[var(--color-surface-raised)]'
                : ''}"
              role="option"
              aria-selected={index === selected}
              onclick={() => choose(index)}
              onmouseenter={() => (selected = index)}
            >
              <span class="w-16 shrink-0 text-xs text-[var(--color-ink-soft)]">
                {hit.command.kind}
              </span>
              <span class="min-w-0 flex-1 truncate">{hit.command.label}</span>
              {#if hit.command.detail}
                <span class="max-w-[40%] shrink-0 truncate text-xs text-[var(--color-ink-soft)]">
                  {hit.command.detail}
                </span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <p class="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-ink-soft)]">
      ↑↓ to move · Enter to choose · Esc to close
    </p>
  </div>
</div>
