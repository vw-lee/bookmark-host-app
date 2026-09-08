<script lang="ts">
  /**
   * The list of tags already in use, offered as native autocomplete (task 7l).
   *
   * Tag drift is the quiet failure mode of every tag system: `reading-list`, `readinglist` and
   * `reading list` become three unrelated branches of the tree, and nothing in the UI ever
   * points it out. Unlike most UI problems this one is cumulative and retroactive — by the
   * time you notice, fixing it means the rename tool and a lot of guessing about intent.
   *
   * A `<datalist>` rather than a custom combobox: it completes on every browser, needs no
   * keyboard handling of its own, and still allows a genuinely new tag to be typed. The one
   * thing it cannot do is complete the second entry in a comma-separated field — browsers match
   * against the whole value — which is why the field text says "comma separated" and this is an
   * aid rather than the only way in.
   */
  import { store } from "../store.svelte";

  interface Props {
    /** Must match the `list` attribute on the input this serves. */
    id: string;
  }
  const { id }: Props = $props();

  // Every node of the tree, parents included, so "dev" completes as readily as "dev/rust".
  const tags = $derived([...store.tagCounts.keys()].sort());
</script>

<datalist {id}>
  {#each tags as tag (tag)}
    <option value={tag}></option>
  {/each}
</datalist>
