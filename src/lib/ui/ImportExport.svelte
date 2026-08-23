<script lang="ts">
  /**
   * Import and export (tasks 4b, 4d, 4g, 4h).
   *
   * The import is two-stage by design: parse and PREVIEW, then apply. The preview is not
   * politeness — normalisation collapses tag spellings and dedupe silently folds links
   * together, and the user needs to see both before several hundred records change.
   */
  import { store } from "../store.svelte";
  import { parseNetscape, planImport, toNetscape, type MergePlan } from "../io/netscape";
  import { serialize } from "../schema/serialize";
  import { liveBookmarks } from "../sync/merge";

  interface Props {
    onClose: () => void;
  }
  const { onClose }: Props = $props();

  let plan = $state<MergePlan | null>(null);
  let filename = $state("");
  let problem = $state<string | null>(null);
  let applied = $state<{ added: number; updated: number } | null>(null);

  async function onFile(event: Event) {
    problem = null;
    applied = null;
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    filename = file.name;
    try {
      const text = await file.text();
      plan = planImport(parseNetscape(text), store.file.bookmarks);
      if (plan.additions.length === 0 && plan.updates.length === 0) {
        problem = "No importable bookmarks were found in that file.";
      }
    } catch {
      problem = "That file could not be read.";
      plan = null;
    }
  }

  function apply() {
    if (!plan) return;
    applied = store.applyImport(plan);
    plan = null;
  }

  /**
   * Downloads are built as blobs and revoked immediately after the click, so nothing is left
   * holding the whole collection in memory.
   */
  function download(content: string, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const stamp = () => new Date().toISOString().slice(0, 10);

  function exportHtml() {
    download(toNetscape(store.file.bookmarks), `bookmarks-${stamp()}.html`, "text/html");
  }

  function exportJson() {
    download(serialize(store.file), `bookmarks-${stamp()}.json`, "application/json");
  }

  const liveCount = $derived(liveBookmarks(store.file).length);
</script>

<div class="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-16">
  <div
    class="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
  >
    <div class="flex items-center justify-between">
      <h2 class="font-semibold">Import and export</h2>
      <button class="text-sm underline" onclick={onClose}>Close</button>
    </div>

    <section class="mt-5">
      <h3 class="text-sm font-medium">Import from a browser</h3>
      <p class="mt-1 text-sm text-[var(--color-ink-soft)]">
        Export your bookmarks from Chrome, Firefox, Safari, or Edge as HTML, then choose the file
        here. Nothing changes until you confirm.
      </p>
      <input
        type="file"
        accept=".html,.htm,text/html"
        class="mt-2 w-full text-sm"
        onchange={onFile}
      />

      {#if problem}
        <p class="mt-2 text-sm text-[var(--color-danger)]">{problem}</p>
      {/if}

      {#if applied}
        <p class="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm">
          Imported {applied.added} new bookmark{applied.added === 1 ? "" : "s"}{applied.updated > 0
            ? `, updated ${applied.updated} existing`
            : ""}.
        </p>
      {/if}

      {#if plan}
        <div class="mt-3 rounded border border-[var(--color-border)] p-3 text-sm">
          <p class="font-medium">{filename}</p>

          <ul class="mt-2 space-y-1 text-[var(--color-ink-soft)]">
            <li>{plan.additions.length} new bookmark{plan.additions.length === 1 ? "" : "s"}</li>
            {#if plan.updates.length > 0}
              <li>{plan.updates.length} already saved — these will be updated, not duplicated</li>
            {/if}
            {#if plan.internalDuplicates > 0}
              <li>{plan.internalDuplicates} duplicate{plan.internalDuplicates === 1 ? "" : "s"} within the file itself</li>
            {/if}
            {#if plan.rejected.length > 0}
              <li class="text-[var(--color-danger)]">
                {plan.rejected.length} skipped — unsupported or unparseable links
              </li>
            {/if}
          </ul>

          {#if plan.tagCollapses.length > 0}
            <div class="mt-3 border-t border-[var(--color-border)] pt-2">
              <p class="font-medium">Folders that will merge into one tag</p>
              <ul class="mt-1 space-y-0.5 text-[var(--color-ink-soft)]">
                {#each plan.tagCollapses as collapse (collapse.canonical)}
                  <li>
                    <code>{collapse.sources.join("</code>, <code>")}</code>
                    → <code>{collapse.canonical}</code>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

          {#if plan.rejected.length > 0}
            <details class="mt-3 border-t border-[var(--color-border)] pt-2">
              <summary class="cursor-pointer">Show skipped links</summary>
              <ul class="mt-1 space-y-0.5 text-xs text-[var(--color-ink-soft)]">
                {#each plan.rejected.slice(0, 25) as entry (entry.url)}
                  <li class="truncate">{entry.url} — {entry.reason}</li>
                {/each}
              </ul>
            </details>
          {/if}

          <div class="mt-3 flex justify-end gap-2">
            <button class="rounded px-3 py-1.5" onclick={() => (plan = null)}>Cancel</button>
            <button
              class="rounded bg-[var(--color-accent)] px-4 py-1.5 font-medium text-white"
              onclick={apply}
            >
              Import {plan.additions.length + plan.updates.length}
            </button>
          </div>
        </div>
      {/if}
    </section>

    <section class="mt-6 border-t border-[var(--color-border)] pt-4">
      <h3 class="text-sm font-medium">Export</h3>
      <p class="mt-1 text-sm text-[var(--color-ink-soft)]">
        {liveCount} bookmark{liveCount === 1 ? "" : "s"}. Your data is yours — these files import
        into any browser or bookmark manager.
      </p>
      <div class="mt-2 flex gap-2">
        <button
          class="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm"
          onclick={exportHtml}
        >
          Bookmarks HTML
        </button>
        <button
          class="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm"
          onclick={exportJson}
        >
          JSON
        </button>
      </div>
    </section>
  </div>
</div>
