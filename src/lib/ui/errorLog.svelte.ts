/**
 * Global error surface.
 *
 * Built because a failure reached the user as "nothing happens" — the worst possible outcome,
 * since it gives neither them nor me anything to work with. Anything that goes wrong anywhere
 * now becomes visible text on screen, including failures nobody predicted: an exception during
 * render, a rejected promise nobody awaited, a browser API refusing a call.
 *
 * This is a backstop, not a replacement for the typed error taxonomy (§4.5). Expected failures
 * should still be reported in context by the component that caused them.
 */

export interface LoggedError {
  id: number;
  message: string;
  detail: string | null;
  at: string;
}

let nextId = 1;

class ErrorLog {
  entries = $state<LoggedError[]>([]);

  push(message: string, detail?: unknown): void {
    const text = detailText(detail);
    // Collapse repeats — a failing poll should not produce a hundred identical banners.
    const duplicate = this.entries.find((e) => e.message === message && e.detail === text);
    if (duplicate) return;

    this.entries = [
      ...this.entries.slice(-4),
      { id: nextId++, message, detail: text, at: new Date().toISOString() },
    ];
    // Also to the console, so a copyable stack exists for a bug report.
    console.error("[bookmarks]", message, detail ?? "");
  }

  dismiss(id: number): void {
    this.entries = this.entries.filter((e) => e.id !== id);
  }

  clear(): void {
    this.entries = [];
  }
}

function detailText(detail: unknown): string | null {
  if (detail === undefined || detail === null) return null;
  if (detail instanceof Error) {
    return detail.stack ? `${detail.name}: ${detail.message}` : String(detail);
  }
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

export const errorLog = new ErrorLog();

/** Catch everything the app does not catch itself. Installed once from main.ts. */
export function installGlobalErrorHandlers(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    errorLog.push(
      event.message || "An unexpected error occurred.",
      event.error ?? `${event.filename}:${event.lineno}`,
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    errorLog.push(
      reason instanceof Error ? reason.message : "An operation failed unexpectedly.",
      reason,
    );
  });
}
