<script lang="ts">
  /**
   * The generated domain tile (task 7g). See tile.ts for why this is derived rather than fetched.
   *
   * The letters are the identity and the colour is decoration, in that order — which is what
   * makes the e-ink rule in app.css (strip the fill, keep the border) a palette change rather
   * than a loss of information, and what keeps the grid legible for colour-blind users.
   */
  import { tileFor, tileColor } from "./tile";

  interface Props {
    url: string;
    /** Tailwind size classes — tiles are larger in speed-dial mode than on a card. */
    size?: string;
  }

  const { url, size = "h-9 w-9 text-sm" }: Props = $props();
  const tile = $derived(tileFor(url));
</script>

<span
  class="bm-tile inline-flex shrink-0 items-center justify-center rounded font-semibold text-white {size}"
  style="background: {tileColor(tile.hue)}"
  aria-hidden="true"
>
  {tile.initials}
</span>
