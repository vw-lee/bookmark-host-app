<script lang="ts">
  /**
   * The sync indicator: a glyph, a word, and a panel with the detail (task 7n).
   *
   * The header can only afford two or three words, and the questions people actually have —
   * "when did it last sync?", "what is queued?", "will I lose this if I close the tab?" — do
   * not fit in that budget. Splitting them is the whole design: the badge answers *whether*
   * things are fine, the panel answers *why*, and nothing is hidden behind a hover.
   *
   * The badge is a `<button>` because it does something. A status that looks clickable but is
   * not is worse than plain text, and a status that is clickable but looks like text never
   * gets clicked.
   *
   * §1.2 compliance: the glyph and the label carry the state; the tone is reinforcement. Under
   * `[data-eink]` the existing button rule strips the fill and the tokens flatten to black,
   * leaving a bordered "✕ Offline" that says exactly what the coloured version said.
   */
  import { store } from "../store.svelte";
  import StatusIcon from "./StatusIcon.svelte";
  import { describeSync, relativeTime, type SyncTone } from "./syncStatus";
  import { formatBytes, SIZE_WARN_BYTES } from "../sync/persistence";

  let open = $state(false);
  let root = $state<HTMLElement | null>(null);
  let panel = $state<HTMLElement | null>(null);
  let now = $state(Date.now());

  $effect(() => {
    if (open) panel?.focus();
  });

  /**
   * The clock only runs when something on screen depends on it: a rate-limit countdown, or an
   * open panel showing "2 minutes ago". A permanent 1s interval would wake the CPU forever to
   * re-render a word that changes once an hour.
   */
  $effect(() => {
    const parked = store.parkedUntil !== null;
    if (!parked && !open) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), parked ? 1000 : 30_000);
    return () => clearInterval(id);
  });

  const status = $derived(
    describeSync({
      connected: store.connected,
      syncing: store.syncing,
      offline: store.offline,
      pendingCount: store.pendingCount,
      parkedUntil: store.parkedUntil,
      lastSyncedAt: store.lastSyncedAt,
      tokenExpired: store.tokenExpired,
      hasError: store.error !== null,
      size: store.size,
      persistence: store.persistence,
      now,
    }),
  );

  /**
   * Tone classes, spelled out rather than composed.
   *
   * Tailwind scans source text for class names, so `text-[var(--color-${tone})]` would compile
   * to nothing at all. Static strings in a lookup are the price of that.
   */
  const TONE: Record<SyncTone, string> = {
    ok: "border-[var(--color-success)] text-[var(--color-success)]",
    busy: "border-[var(--color-accent)] text-[var(--color-accent)]",
    warn: "border-[var(--color-warn)] text-[var(--color-warn)]",
    bad: "border-[var(--color-danger)] text-[var(--color-danger)]",
  };

  /** Queued work that has not reached GitHub is the only thing that can actually be lost. */
  const atRisk = $derived(store.persistence !== "granted" && store.pendingCount > 0);

  function onWindowPointerDown(event: MouseEvent) {
    if (!open) return;
    if (root && !root.contains(event.target as Node)) open = false;
  }

  function onPanelKeydown(event: KeyboardEvent) {
    // Stopped, not just handled: the window-level Escape in App.svelte would otherwise also
    // clear the user's selection on the way past.
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      open = false;
    }
  }

  function syncNow() {
    store.flushNow();
    store.refreshOnFocus();
    open = false;
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="relative" bind:this={root}>
  <button
    class="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium {TONE[
      status.tone
    ]}"
    onclick={() => (open = !open)}
    aria-expanded={open}
    aria-label="Sync status: {status.label}. {status.summary}"
    title={status.summary}
  >
    <StatusIcon icon={status.icon} />
    <!-- The live region is the label alone. Announcing the whole button on every state change
         would re-read "button, expanded" each time a sync finishes. -->
    <span role="status" aria-live="polite">{status.label}</span>
  </button>

  {#if open}
    <!--
      Focused on open, which `tabindex="-1"` is what allows. Without it the panel is a dialog
      keyboard focus can never enter, so Escape would go to the window handler in App.svelte and
      clear the user's selection instead of closing this.
    -->
    <div
      bind:this={panel}
      class="absolute right-0 top-full z-60 mt-2 w-72 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm shadow-lg"
      role="dialog"
      aria-label="Sync details"
      tabindex="-1"
      onkeydown={onPanelKeydown}
    >
      <p class="flex items-start gap-2 font-medium {TONE[status.tone]} border-0">
        <span class="mt-0.5"><StatusIcon icon={status.icon} size="1rem" /></span>
        <span>{status.label}</span>
      </p>
      <p class="mt-1 text-[var(--color-ink-soft)]">{status.summary}</p>

      <dl class="mt-3 space-y-1.5 border-t border-[var(--color-border)] pt-3 text-xs">
        <div class="flex justify-between gap-3">
          <dt class="text-[var(--color-ink-soft)]">Last synced</dt>
          <dd class="text-right">{relativeTime(store.lastSyncedAt, now)}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-[var(--color-ink-soft)]">Waiting to sync</dt>
          <dd class="text-right">
            {store.pendingCount === 0 ? "nothing" : `${store.pendingCount} change${store.pendingCount === 1 ? "" : "s"}`}
          </dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-[var(--color-ink-soft)]">GitHub</dt>
          <dd class="text-right">{store.connected ? "connected" : "not connected"}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <!-- Only meaningful because of §6.3: without persistent storage the browser may
               evict the queue that holds unsynced work. -->
          <dt class="text-[var(--color-ink-soft)]">Device storage</dt>
          <dd class="text-right {atRisk ? 'text-[var(--color-danger)]' : ''}">
            {store.persistence === "granted" ? "persistent" : store.persistence}
          </dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-[var(--color-ink-soft)]">File size</dt>
          <dd class="text-right {store.size.level === 'ok' ? '' : 'text-[var(--color-danger)]'}">
            {formatBytes(store.size.bytes)}{store.size.level === "ok"
              ? ""
              : ` of ${formatBytes(SIZE_WARN_BYTES)}+`}
          </dd>
        </div>
      </dl>

      {#if atRisk}
        <p class="mt-3 text-xs text-[var(--color-danger)]">
          Queued changes could be cleared if this device runs low on space. Installing the app
          usually grants persistent storage.
        </p>
      {/if}

      <div class="mt-3 flex items-center gap-3">
        {#if store.connected && !store.offline}
          <button
            class="rounded border border-[var(--color-border)] px-2.5 py-1 text-xs"
            onclick={syncNow}
          >
            Sync now
          </button>
        {/if}
        <button class="text-xs underline" onclick={() => (open = false)}>Close</button>
      </div>
    </div>
  {/if}
</div>
