<script lang="ts">
  /**
   * Edit / pin / archive / delete, shared by every view mode (task 7g).
   *
   * Always rendered, never revealed on hover. §1.2 forbids hover-dependent affordances for
   * e-ink, and the same rule is what makes the grid usable on a touchscreen, where there is no
   * hover to depend on.
   */
  import type { Bookmark } from "../schema/types";

  interface Props {
    bookmark: Bookmark;
    onEdit: () => void;
    onDelete: (id: string) => void;
    onUpdate: (id: string, patch: Partial<Bookmark>) => void;
    /** Table rows sit in a tight cell and cannot afford the padded buttons. */
    compact?: boolean;
  }

  const { bookmark, onEdit, onDelete, onUpdate, compact = false }: Props = $props();

  const base = $derived(
    `rounded ${compact ? "px-1.5 py-0.5" : "px-2 py-1"} hover:bg-[var(--color-surface-raised)]`,
  );
</script>

<div class="flex shrink-0 flex-wrap justify-end gap-1 text-xs">
  <button class="{base} text-[var(--color-ink-soft)]" onclick={onEdit}>edit</button>
  <button
    class="{base} text-[var(--color-ink-soft)]"
    onclick={() => onUpdate(bookmark.id, { pinned: !bookmark.pinned })}
  >
    {bookmark.pinned ? "unpin" : "pin"}
  </button>
  <button
    class="{base} text-[var(--color-ink-soft)]"
    onclick={() => onUpdate(bookmark.id, { archived: !bookmark.archived })}
  >
    {bookmark.archived ? "restore" : "archive"}
  </button>
  <button class="{base} text-[var(--color-danger)]" onclick={() => onDelete(bookmark.id)}>
    delete
  </button>
</div>
