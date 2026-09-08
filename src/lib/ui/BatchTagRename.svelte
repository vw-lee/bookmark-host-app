<script lang="ts">
  /**
   * Batch tag rename (task 7p).
   *
   * The single rename above this in Bulk tools is the right tool for one decision. It is the
   * wrong tool for the job people actually have, which arrives all at once: an import lands 300
   * browser bookmarks and the tag tree now holds `readinglist`, `reading list`, `Reading List`,
   * `dev`, `Dev` and `development` as six unrelated branches. Fixing that one rename at a time
   * means typing a name, reading a preview, applying, and repeating — and each apply is its own
   * commit, so a dozen tidy-ups become a dozen round trips to GitHub.
   *
   * This is the same operation with the preview computed across every rule at once and applied
   * as a single change. One commit, one undo entry, one confirmation.
   *
   * The load-bearing detail is in `planBatchRename`: rules are applied in ONE pass, never
   * chained, with the most specific source winning. That is what makes the previewed counts
   * true and makes row order stop mattering — see the comment on `rewriteTag`.
   */
  import { store } from "../store.svelte";
  import { planBatchRename, type RenameRule, type RuleProblem } from "../io/bulk";
  import TagVocabulary from "./TagVocabulary.svelte";

  interface Props {
    /** Reports what happened, so the panel keeps one result line rather than several. */
    onDone: (message: string) => void;
  }
  const { onDone }: Props = $props();

  /** Two blank rows to start: one row looks like the single rename this exists to replace. */
  let rules = $state<RenameRule[]>([
    { from: "", to: "" },
    { from: "", to: "" },
  ]);
  let confirming = $state(false);

  const plan = $derived(planBatchRename(store.file.bookmarks, rules));
  const collisions = $derived(plan.rows.flatMap((row) => row.collisions));

  /** Only complete, non-blank rows can be wrong in a way worth reporting. */
  function problemText(problem: RuleProblem | null): string | null {
    switch (problem) {
      case "same":
        return "already that tag";
      case "duplicate":
        return "an earlier row renames this";
      case "no-match":
        return "no tags match";
      default:
        return null;
    }
  }

  function addRow() {
    rules = [...rules, { from: "", to: "" }];
  }

  function removeRow(index: number) {
    // Never leave the table empty — a table with no rows has no way back to having one.
    rules = rules.length > 1 ? rules.filter((_, i) => i !== index) : [{ from: "", to: "" }];
    confirming = false;
  }

  function apply() {
    const applicable = plan.applicable;
    const affected = store.renameTagsBatch(rules);
    confirming = false;
    rules = [
      { from: "", to: "" },
      { from: "", to: "" },
    ];
    onDone(
      affected === 0
        ? "Nothing matched those rules, so nothing changed."
        : `Renamed ${applicable} tag${applicable === 1 ? "" : "s"} across ${affected} bookmark${affected === 1 ? "" : "s"}. Undo is available for a moment.`,
    );
  }
</script>

<section class="mt-6 border-t border-[var(--color-border)] pt-4">
  <h3 class="text-sm font-medium">Batch rename tags</h3>
  <p class="mt-1 text-sm text-[var(--color-ink-soft)]">
    Several renames at once, previewed together and applied as one undoable change. Each rename
    carries its whole subtree, so renaming <code>dev</code> also moves <code>dev/rust</code>.
  </p>

  <div class="mt-3 overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="text-left text-xs text-[var(--color-ink-soft)]">
          <th class="pb-1 font-normal">From</th>
          <th class="pb-1 font-normal">To</th>
          <th class="pb-1 pl-2 text-right font-normal">Affects</th>
          <th class="pb-1"><span class="sr-only">Remove row</span></th>
        </tr>
      </thead>
      <tbody>
        {#each rules as rule, i (i)}
          {@const row = plan.rows[i]}
          <tr>
            <td class="py-0.5 pr-1">
              <input
                bind:value={rule.from}
                list="bm-tags-batch"
                placeholder="readinglist"
                aria-label="Rename tag {i + 1} from"
                class="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 text-sm"
              />
            </td>
            <td class="py-0.5 pr-1">
              <input
                bind:value={rule.to}
                list="bm-tags-batch"
                placeholder="reading-list"
                aria-label="Rename tag {i + 1} to"
                class="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 text-sm"
              />
            </td>
            <!--
              The count is the honest part of this table. A row that looks complete and does
              nothing is the failure mode of every find-and-replace, so a matching count and a
              reason for zero are given equal weight.
            -->
            <td class="whitespace-nowrap py-0.5 pl-2 text-right text-xs">
              {#if row && row.problem === null}
                {row.affected}
              {:else if row && problemText(row.problem)}
                <span class="text-[var(--color-warn)]">{problemText(row.problem)}</span>
              {:else}
                <span class="text-[var(--color-ink-soft)]">—</span>
              {/if}
            </td>
            <td class="py-0.5 pl-1">
              <button
                class="px-1 text-xs text-[var(--color-ink-soft)] underline"
                onclick={() => removeRow(i)}
                aria-label="Remove rename row {i + 1}"
              >
                Remove
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <TagVocabulary id="bm-tags-batch" />

  <button class="mt-2 text-xs underline" onclick={addRow}>+ Add row</button>

  {#if plan.applicable > 0}
    <div class="mt-3 rounded border border-[var(--color-border)] p-2 text-xs">
      <p class="font-medium">
        {plan.affected} bookmark{plan.affected === 1 ? "" : "s"} affected by
        {plan.applicable} rule{plan.applicable === 1 ? "" : "s"}.
      </p>
      <ul class="mt-1 space-y-0.5 text-[var(--color-ink-soft)]">
        {#each plan.rows.filter((r) => r.problem === null) as row (row.index)}
          {#each row.examples as example (example.from)}
            <li><code>{example.from}</code> → <code>{example.to}</code></li>
          {/each}
        {/each}
      </ul>

      {#if collisions.length > 0}
        <!-- Usually the point rather than a mistake — merging three spellings into one is why
             anybody opens this — but never something to discover after the fact. -->
        <p class="mt-1.5 text-[var(--color-warn)]">
          Merges into existing tag{collisions.length === 1 ? "" : "s"}:
          {[...new Set(collisions)].join(", ")}. The bookmarks keep every other tag.
        </p>
      {/if}
    </div>

    {#if confirming}
      <div class="mt-2 flex items-center gap-3">
        <button
          class="rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
          onclick={apply}
        >
          Rename across {plan.affected} bookmark{plan.affected === 1 ? "" : "s"}?
        </button>
        <button class="text-sm underline" onclick={() => (confirming = false)}>Cancel</button>
      </div>
    {:else}
      <button
        class="mt-2 rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
        onclick={() => (confirming = true)}
      >
        Rename all
      </button>
    {/if}
  {/if}
</section>
