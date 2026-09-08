<script lang="ts">
  /**
   * The keyboard shortcut list, on "?" (task 7m).
   *
   * "?" used to open the command palette, which was a reasonable stand-in while there were four
   * shortcuts and no list of them. It is the wrong answer now: the palette shows what you can
   * DO, and this shows how to do it without the mouse. They are different questions, and the
   * palette could never answer the second one because a fuzzy-matched command list has nowhere
   * to put "j moves down".
   *
   * The search syntax is documented here too. An operator nobody can discover is an operator
   * nobody uses, and this is the one place a user already comes looking for "how do I drive
   * this thing".
   */
  interface Props {
    onClose: () => void;
  }
  const { onClose }: Props = $props();

  let panel = $state<HTMLElement | null>(null);

  // Focused on open so Escape reaches this dialog rather than the window handler behind it,
  // and so a screen reader lands inside the thing that just appeared.
  $effect(() => {
    panel?.focus();
  });

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  const groups: { title: string; rows: [string, string][] }[] = [
    {
      title: "Getting around",
      rows: [
        ["j  /  ↓", "Next bookmark"],
        ["k  /  ↑", "Previous bookmark"],
        ["Enter", "Open the focused bookmark in a new tab"],
        ["e", "Edit the focused bookmark"],
        ["x", "Select the focused bookmark"],
        ["Delete", "Delete the focused bookmark — undoable"],
      ],
    },
    {
      title: "Turning pages",
      rows: [
        ["Page Down", "Next page of bookmarks"],
        ["Page Up", "Previous page"],
        ["Home", "First page"],
        ["End", "Last page"],
      ],
    },
    {
      title: "Finding things",
      rows: [
        ["/", "Jump to search"],
        ["Ctrl / ⌘ + K", "Command palette"],
        ["Ctrl / ⌘ + Shift + K", "Add a bookmark"],
        ["v", "Cycle view: list, cards, tiles, table"],
        ["Escape", "Close this, or clear the selection"],
        ["?", "This list"],
      ],
    },
    {
      title: "Search syntax",
      rows: [
        ["tag:dev/rust", "Has that tag, or one nested under it"],
        ["site:example.com", "The host contains this"],
        ["is:pinned", "Pinned only"],
        ["is:untagged", "No tags yet — what to fix after an import"],
        ['"exact phrase"', "Matches as one phrase, not separate words"],
        ["-tag:archive", "A leading minus excludes"],
      ],
    },
  ];
</script>

<div class="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-16">
  <div
    bind:this={panel}
    class="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
    role="dialog"
    aria-modal="true"
    aria-label="Keyboard shortcuts"
    tabindex="-1"
    onkeydown={onKeydown}
  >
    <div class="flex items-center justify-between">
      <h2 class="font-semibold">Keyboard shortcuts</h2>
      <button class="text-sm underline" onclick={onClose}>Close</button>
    </div>

    <div class="mt-4 grid gap-6 sm:grid-cols-2">
      {#each groups as group (group.title)}
        <section>
          <h3 class="text-sm font-medium">{group.title}</h3>
          <dl class="mt-2 space-y-1.5 text-sm">
            {#each group.rows as [keys, meaning] (keys)}
              <div class="flex items-baseline justify-between gap-3">
                <dt class="shrink-0">
                  <kbd
                    class="rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-1.5 py-0.5 font-mono text-xs"
                    >{keys}</kbd
                  >
                </dt>
                <dd class="text-right text-[var(--color-ink-soft)]">{meaning}</dd>
              </div>
            {/each}
          </dl>
        </section>
      {/each}
    </div>

    <p class="mt-5 text-xs text-[var(--color-ink-soft)]">
      Shortcuts are ignored while you are typing in a field, so "/" and "j" stay ordinary
      characters in the search box.
    </p>
  </div>
</div>
