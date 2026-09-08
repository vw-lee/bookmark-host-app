<script lang="ts">
  /**
   * Install offer (task 5g).
   *
   * Deliberately NOT shown during setup. Installing is what unlocks the Android share target
   * and what gets persistent storage granted (§6.4), but none of that is meaningful to someone
   * who has not yet saved a bookmark — so the offer waits until they have.
   *
   * iOS has no programmatic trigger at all, so it gets written instructions instead.
   */
  import { promptInstall, isIos, isInstalled } from "../pwa/install";
  import { store } from "../store.svelte";

  interface Props {
    available: boolean;
    onDismiss: () => void;
  }
  const { available, onDismiss }: Props = $props();

  const ios = isIos();
  const installed = isInstalled();
  const hasBookmarks = $derived(store.file.bookmarks.some((b) => !b.deletedAt));
  const show = $derived(!installed && hasBookmarks && (available || ios));

  async function install() {
    if (await promptInstall()) {
      // Installation is the moment persistent storage is likely to be granted (task 5h).
      await store.ensurePersistence();
    }
    onDismiss();
  }
</script>

{#if show}
  <aside
    class="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm"
  >
    {#if ios}
      <span>
        Add to your Home Screen for offline access: tap <strong>Share</strong>, then
        <strong>Add to Home Screen</strong>.
      </span>
    {:else}
      <span>Install the app for offline access, sharing from other apps, and safer storage.</span>
      <button
        class="rounded bg-[var(--color-accent)] px-3 py-1 font-medium text-white"
        onclick={install}
      >
        Install
      </button>
    {/if}
    <button class="ml-auto underline" onclick={onDismiss}>Not now</button>
  </aside>
{/if}
