<script lang="ts">
  /**
   * Quick-add modal (task 2a).
   *
   * Keyboard-driven and URL-first: paste, tab, type tags, Enter. Rejects unsafe schemes at the
   * save boundary using the same validator the renderer uses (§5.4), and reports a dedupe hit
   * rather than silently creating a second record for the same link (task 2g).
   */
  import { store } from "../store.svelte";
  import { isSafeUrl, normalizeUrlKey } from "../schema/normalize";
  import { liveBookmarks } from "../sync/merge";

  interface Props {
    onClose: () => void;
  }
  const { onClose }: Props = $props();

  let url = $state("");
  let title = $state("");
  let tags = $state("");
  let problem = $state<string | null>(null);
  let urlInput = $state<HTMLInputElement | null>(null);

  $effect(() => {
    urlInput?.focus();
  });

  const duplicate = $derived.by(() => {
    const key = normalizeUrlKey(url);
    if (!key) return null;
    return liveBookmarks(store.file).find((b) => b.urlKey === key) ?? null;
  });

  function save(event: SubmitEvent) {
    event.preventDefault();
    problem = null;

    const trimmed = url.trim();
    if (!isSafeUrl(trimmed)) {
      problem = "Only http and https links can be saved.";
      return;
    }

    const record = store.addBookmark({
      url: trimmed,
      title: title.trim(),
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });

    if (!record) {
      problem = "That link could not be saved.";
      return;
    }
    onClose();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-24">
  <div
    class="w-full max-w-lg rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl"
  >
    <h2 class="font-semibold">Add bookmark</h2>

    <form class="mt-4 space-y-3" onsubmit={save}>
      <label class="block text-sm">
        <span class="text-[var(--color-ink-soft)]">URL</span>
        <input
          bind:this={urlInput}
          bind:value={url}
          class="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2"
          placeholder="https://…"
          required
          autocomplete="off"
          spellcheck="false"
        />
      </label>

      {#if duplicate}
        <p class="rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm">
          Already saved as <strong>{duplicate.title}</strong>. Saving will update it rather than
          add a copy.
        </p>
      {/if}

      <label class="block text-sm">
        <span class="text-[var(--color-ink-soft)]">Title <em>(optional)</em></span>
        <input
          bind:value={title}
          class="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2"
          placeholder="Defaults to the site name"
          autocomplete="off"
        />
      </label>

      <label class="block text-sm">
        <span class="text-[var(--color-ink-soft)]">Tags <em>(comma separated)</em></span>
        <input
          bind:value={tags}
          class="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2"
          placeholder="dev/rust, reading-list"
          autocomplete="off"
        />
      </label>

      {#if problem}
        <p class="text-sm text-[var(--color-danger)]">{problem}</p>
      {/if}

      <div class="flex justify-end gap-2 pt-1">
        <button type="button" class="rounded px-3 py-2 text-sm" onclick={onClose}>Cancel</button>
        <button
          type="submit"
          class="rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
        >
          {duplicate ? "Update" : "Save"}
        </button>
      </div>
    </form>
  </div>
</div>
