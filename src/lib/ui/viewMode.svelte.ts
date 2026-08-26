/**
 * View modes (task 7g).
 *
 * Four ways to render the same page of bookmarks. The mode is a *device* preference, not
 * collection data: a phone wants tiles where a desktop wants a table, and syncing that choice
 * through bookmarks.json would make the two devices fight over it. So it lives in
 * localStorage next to the theme (7b) and never enters the merge.
 */

export type ViewMode = "list" | "cards" | "tiles" | "table";

export const VIEW_MODES: readonly ViewMode[] = ["list", "cards", "tiles", "table"];

const STORAGE_KEY = "bm.view";

/** Labels for the switcher and the command palette. */
export const VIEW_LABELS: Record<ViewMode, string> = {
  list: "List",
  cards: "Cards",
  tiles: "Tiles",
  table: "Table",
};

/**
 * A screenful differs sharply by mode, and pagination (7c) is fixed-size rather than
 * viewport-aware, so the page size follows the mode. These are tuned to roughly two scrolls on
 * a laptop: enough that paging is rare, few enough that a page is still a page.
 */
export function pageSizeFor(mode: ViewMode): number {
  switch (mode) {
    case "cards":
      return 24;
    case "tiles":
      return 60;
    default:
      return 50;
  }
}

function read(): ViewMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (VIEW_MODES as readonly string[]).includes(stored)) return stored as ViewMode;
  } catch {
    /* storage can be blocked outright; fall through to the default */
  }
  return "list";
}

class ViewStore {
  /**
   * List stays the default. It is the only mode verified against every §1.2 e-ink rule, and a
   * first run should not open onto a layout the user did not choose.
   */
  current = $state<ViewMode>(read());

  set(mode: ViewMode): void {
    this.current = mode;
    try {
      if (mode === "list") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* the mode still applies for this session */
    }
  }

  /** Cycle forward — what the keyboard shortcut and the palette entry both call. */
  next(): void {
    const at = VIEW_MODES.indexOf(this.current);
    this.set(VIEW_MODES[(at + 1) % VIEW_MODES.length] ?? "list");
  }

  get pageSize(): number {
    return pageSizeFor(this.current);
  }
}

export const view = new ViewStore();
