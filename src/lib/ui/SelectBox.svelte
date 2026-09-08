<script lang="ts">
  /**
   * The per-record selection checkbox (task 7k).
   *
   * One component rather than four copies, because the four views disagree about everything
   * except this: a checkbox bound to `store.selection`, labelled with the title so a screen
   * reader announces which record is being selected rather than four identical "checkbox"es.
   *
   * `stopPropagation` matters in the card and tile views, where the whole surface is a link.
   */
  import { store } from "../store.svelte";
  import type { Bookmark } from "../schema/types";

  interface Props {
    bookmark: Bookmark;
  }
  const { bookmark }: Props = $props();
</script>

<input
  type="checkbox"
  class="mt-1 shrink-0 cursor-pointer"
  checked={store.isSelected(bookmark.id)}
  onclick={(event) => event.stopPropagation()}
  onchange={() => store.toggleSelected(bookmark.id)}
  aria-label="Select {bookmark.title}"
/>
