<script lang="ts">
  /** Renders anything the global error log has caught. Always mounted, above every screen. */
  import { errorLog } from "./errorLog.svelte";
</script>

{#if errorLog.entries.length > 0}
  <div class="border-b-2 border-[var(--color-danger)] bg-[var(--color-surface-raised)]">
    {#each errorLog.entries as entry (entry.id)}
      <div class="flex items-start gap-3 px-4 py-2 text-sm">
        <div class="min-w-0 flex-1">
          <p class="font-medium text-[var(--color-danger)]">{entry.message}</p>
          {#if entry.detail}
            <details class="mt-1">
              <summary class="cursor-pointer text-xs text-[var(--color-ink-soft)]">
                Technical detail
              </summary>
              <pre class="mt-1 overflow-x-auto text-xs whitespace-pre-wrap">{entry.detail}</pre>
            </details>
          {/if}
        </div>
        <button
          class="shrink-0 text-xs underline"
          onclick={() => errorLog.dismiss(entry.id)}
          aria-label="Dismiss error">dismiss</button
        >
      </div>
    {/each}
  </div>
{/if}
