/**
 * Command palette matching and ranking (task 7a).
 *
 * Pure functions, so the ranking is testable without a DOM. The scoring is deliberately simple —
 * subsequence matching with position and word-boundary bonuses. A fuzzy-search dependency would
 * rank better on paper, but at this collection size (§1.1) it would be weight for no perceptible
 * gain, and ranking nobody can predict is worse than ranking that is merely adequate.
 */

export type CommandKind = "action" | "bookmark" | "tag";

export interface Command {
  id: string;
  kind: CommandKind;
  label: string;
  /** Secondary line — a URL, a count, a keyboard hint. */
  detail?: string;
  /** Extra text that should match but is not displayed. */
  keywords?: string;
  run: () => void;
}

export interface ScoredCommand {
  command: Command;
  score: number;
}

/**
 * Score `text` against `query`. Returns -1 for no match.
 *
 * Every query character must appear in order. Consecutive runs, matches at a word boundary, and
 * matches near the start all score higher.
 */
export function score(text: string, query: string): number {
  if (!query) return 0;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  // A plain substring hit is always the strongest signal.
  const direct = haystack.indexOf(needle);
  if (direct === 0) return 1000;
  if (direct > 0) return 800 - Math.min(direct, 100) + (isBoundary(haystack, direct) ? 50 : 0);

  let total = 0;
  let index = 0;
  let previous = -1;
  let run = 0;
  let boundaryHits = 0;

  for (const char of needle) {
    const found = haystack.indexOf(char, index);
    if (found === -1) return -1;

    run = found === previous + 1 ? run + 1 : 0;
    total += 10 + run * 15;
    if (isBoundary(haystack, found)) {
      total += 20;
      boundaryHits += 1;
    }
    if (found < 10) total += 5;

    previous = found;
    index = found + 1;
  }

  // An acronym match — every character landing on a word boundary — is almost always what the
  // user meant. Typing "dr" should find "dev rust" ahead of "bedroom", which merely happens to
  // contain those letters mid-word.
  if (boundaryHits === needle.length) total += 900;

  return total;
}

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  return /[\s/\-_.:]/.test(text[index - 1] ?? "");
}

/** Rank commands against a query. An empty query keeps the original order. */
export function rank(commands: Command[], query: string, limit = 30): ScoredCommand[] {
  const trimmed = query.trim();
  if (!trimmed) return commands.slice(0, limit).map((command) => ({ command, score: 0 }));

  const scored: ScoredCommand[] = [];
  for (const command of commands) {
    const best = Math.max(
      score(command.label, trimmed),
      command.detail ? score(command.detail, trimmed) - 100 : -1,
      command.keywords ? score(command.keywords, trimmed) - 50 : -1,
    );
    if (best >= 0) scored.push({ command, score: best });
  }

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Stable tie-break: actions before tags before bookmarks, then alphabetical.
      const order: Record<CommandKind, number> = { action: 0, tag: 1, bookmark: 2 };
      const kindDelta = order[a.command.kind] - order[b.command.kind];
      return kindDelta !== 0 ? kindDelta : a.command.label.localeCompare(b.command.label);
    })
    .slice(0, limit);
}
