/**
 * Theme system (task 7b, decision D14).
 *
 * Three themes. E-ink is not a dark mode variant — it is a different set of rules, and §1.2
 * specifies them: no animation, no spinners, pure black on pure white, no colour-only
 * signalling, no hover-dependent affordances, large hit targets.
 *
 * It cannot be auto-detected. No browser API reports "this is an e-ink panel", and guessing from
 * refresh rate or colour depth would be wrong often enough to be worse than asking. So it is a
 * deliberate choice, remembered per device.
 */

export type Theme = "system" | "light" | "dark" | "eink";

const STORAGE_KEY = "bm.theme";

function read(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "eink") return stored;
  } catch {
    /* storage can be blocked outright; fall through to the default */
  }
  return "system";
}

class ThemeStore {
  current = $state<Theme>(read());

  set(theme: Theme): void {
    this.current = theme;
    try {
      if (theme === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* the theme still applies for this session */
    }
    this.apply();
  }

  /**
   * Reflect the theme onto <html>, where the CSS in app.css keys off it.
   *
   * `data-eink` is separate from `data-theme` because e-ink changes behaviour, not only
   * colour — CSS elsewhere disables animation and transitions off that attribute alone.
   */
  apply(): void {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (this.current === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", this.current);
    root.toggleAttribute("data-eink", this.current === "eink");
  }

  get isEink(): boolean {
    return this.current === "eink";
  }
}

export const theme = new ThemeStore();
