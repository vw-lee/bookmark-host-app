<script lang="ts">
  /**
   * Unlock screen for a PIN-wrapped token (D13).
   *
   * Shown instead of the full setup form when a wrapped token is stored — the repository is
   * already configured, so all that is needed is the passphrase.
   */
  import { store } from "../store.svelte";
  import { clearConnection, loadTarget } from "../api/tokenStore";
  import { errorLog } from "./errorLog.svelte";

  let pin = $state("");
  let busy = $state(false);
  let problem = $state<string | null>(null);
  let field = $state<HTMLInputElement | null>(null);

  const target = loadTarget();

  $effect(() => {
    field?.focus();
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    problem = null;
    busy = true;
    try {
      if (!(await store.unlock(pin))) {
        problem = "That passphrase does not match. Try again.";
        pin = "";
      }
    } catch (e) {
      problem = (e as Error)?.message ?? "Could not unlock.";
      errorLog.push("Unlock failed unexpectedly", e);
    } finally {
      busy = false;
    }
  }

  function forget() {
    clearConnection();
    store.locked = false;
    store.wantsSetup = true;
  }
</script>

<div class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
  <h1 class="text-2xl font-semibold">Bookmarks</h1>
  <p class="mt-2 text-sm text-[var(--color-ink-soft)]">
    {#if target}
      Unlock <strong>{target.owner}/{target.repo}</strong> with your passphrase.
    {:else}
      Enter your passphrase to unlock.
    {/if}
  </p>

  <form class="mt-6 space-y-3" onsubmit={submit}>
    <label class="block text-sm">
      <span class="text-[var(--color-ink-soft)]">Passphrase</span>
      <input
        bind:this={field}
        bind:value={pin}
        type="password"
        class="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2"
        autocomplete="current-password"
        required
      />
    </label>

    {#if problem}
      <p class="text-sm text-[var(--color-danger)]">{problem}</p>
    {/if}

    <button
      type="submit"
      class="w-full rounded bg-[var(--color-accent)] px-4 py-2 font-medium text-white disabled:opacity-60"
      disabled={busy}
    >
      {busy ? "Unlocking…" : "Unlock"}
    </button>
  </form>

  <button class="mt-6 text-xs text-[var(--color-ink-soft)] underline" onclick={forget}>
    Forget this token and start over
  </button>
</div>
