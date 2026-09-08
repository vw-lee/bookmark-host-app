<script lang="ts">
  /**
   * The three status glyphs — tick, wait, cross (task 7n).
   *
   * Inline SVG rather than a text character or an icon font. `✓` and `✕` render at wildly
   * different weights and baselines across platforms, and a font is a network dependency this
   * app refuses to take on for three shapes.
   *
   * Every stroke uses `currentColor`, so the tone is set once by the parent's text colour and
   * the e-ink theme's flattening of that colour needs no special case here.
   *
   * `aria-hidden`: the glyph is always accompanied by its label, and a screen reader announcing
   * "image, tick" before "Synced" is noise, not information.
   */
  interface Props {
    icon: "tick" | "wait" | "cross";
    /** Side length in rem. Matches the surrounding text size by default. */
    size?: string;
  }
  const { icon, size = "0.875rem" }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="2.25"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  class="shrink-0"
>
  {#if icon === "tick"}
    <path d="M3 8.5 L6.5 12 L13 4" />
  {:else if icon === "cross"}
    <path d="M4 4 L12 12 M12 4 L4 12" />
  {:else}
    <!-- Three dots, not a spinner: §1.2 rules out animation, and a static "in progress" mark
         has to work on a panel that may not repaint for a second. -->
    <circle cx="3" cy="8" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="13" cy="8" r="1.15" fill="currentColor" stroke="none" />
  {/if}
</svg>
