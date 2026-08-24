import { describe, it, expect } from "vitest";
import { score, rank, type Command } from "./palette";

function command(id: string, label: string, over: Partial<Command> = {}): Command {
  return { id, kind: "bookmark", label, run: () => {}, ...over };
}

describe("score (7a)", () => {
  it("ranks a prefix match highest", () => {
    expect(score("rust lang", "rust")).toBeGreaterThan(score("the rust book", "rust"));
  });

  it("matches a subsequence", () => {
    expect(score("dev/rust/async", "dra")).toBeGreaterThan(0);
  });

  it("returns -1 when a character is missing", () => {
    expect(score("rust", "rustz")).toBe(-1);
  });

  it("ranks an acronym match above an incidental mid-word substring", () => {
    // Typing "dr" means "dev rust", not "bedroom".
    expect(score("dev rust", "dr")).toBeGreaterThan(score("bedroom", "dr"));
  });

  it("still ranks a real prefix above an acronym", () => {
    expect(score("drafts", "dr")).toBeGreaterThan(score("dev rust", "dr"));
  });

  it("treats an empty query as neutral", () => {
    expect(score("anything", "")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(score("Rust Lang", "rust")).toBe(score("rust lang", "RUST"));
  });
});

describe("rank (7a)", () => {
  const commands = [
    command("a", "Add bookmark", { kind: "action" }),
    command("b", "Archive view", { kind: "action" }),
    command("c", "rust-lang.org", { detail: "https://rust-lang.org" }),
    command("d", "dev/rust", { kind: "tag", detail: "12 bookmarks" }),
  ];

  it("returns everything for an empty query, in order", () => {
    expect(rank(commands, "").map((r) => r.command.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("filters out non-matches", () => {
    const ids = rank(commands, "zzz").map((r) => r.command.id);
    expect(ids).toEqual([]);
  });

  it("puts the strongest label match first", () => {
    expect(rank(commands, "rust")[0]!.command.id).toBe("c");
  });

  it("matches on detail, ranked below a label match", () => {
    // "bookmark" is in the label of a and the detail of d; the label match must win.
    const ids = rank(commands, "bookmark").map((r) => r.command.id);
    expect(ids[0]).toBe("a");
    expect(ids).toContain("d");
  });

  it("matches text that appears only in the detail", () => {
    expect(rank(commands, "bookmarks").map((r) => r.command.id)).toEqual(["d"]);
  });

  it("prefers actions over tags over bookmarks on a tie", () => {
    const tied = [
      command("x", "same", { kind: "bookmark" }),
      command("y", "same", { kind: "tag" }),
      command("z", "same", { kind: "action" }),
    ];
    expect(rank(tied, "same").map((r) => r.command.id)).toEqual(["z", "y", "x"]);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 100 }, (_, i) => command(String(i), `item ${i}`));
    expect(rank(many, "item", 5)).toHaveLength(5);
  });
});
