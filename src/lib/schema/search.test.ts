import { describe, it, expect } from "vitest";
import { parseQuery, matchesQuery, isEmptyQuery } from "./search";
import type { Bookmark } from "./types";

function bm(over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "01J0000000000000000000000A",
    url: "https://doc.rust-lang.org/book/ch01.html",
    urlKey: "doc.rust-lang.org/book/ch01.html",
    title: "The Rust Programming Language",
    description: "The book",
    notes: "",
    tags: ["dev/rust", "reading list"],
    favicon: null,
    pinned: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    enrichedAt: null,
    ...over,
  };
}

const match = (query: string, over: Partial<Bookmark> = {}) =>
  matchesQuery(bm(over), parseQuery(query));

describe("parseQuery", () => {
  it("treats an empty query as no filter", () => {
    expect(isEmptyQuery(parseQuery(""))).toBe(true);
    expect(isEmptyQuery(parseQuery("   "))).toBe(true);
    expect(isEmptyQuery(parseQuery("rust"))).toBe(false);
  });

  it("splits operators from plain words", () => {
    const parsed = parseQuery("tag:dev/rust site:example.com is:pinned book");
    expect(parsed.tags).toEqual([{ value: "dev/rust", negated: false }]);
    expect(parsed.sites).toEqual([{ value: "example.com", negated: false }]);
    expect(parsed.flags).toEqual([{ value: "pinned", negated: false }]);
    expect(parsed.words).toEqual([{ value: "book", negated: false }]);
  });

  it("reads a leading dash as negation", () => {
    const parsed = parseQuery("-tag:archive -rust");
    expect(parsed.tags).toEqual([{ value: "archive", negated: true }]);
    expect(parsed.words).toEqual([{ value: "rust", negated: true }]);
  });

  it("keeps quoted values whole", () => {
    expect(parseQuery('tag:"reading list"').tags).toEqual([
      { value: "reading list", negated: false },
    ]);
    expect(parseQuery('"the rust book"').words).toEqual([
      { value: "the rust book", negated: false },
    ]);
  });

  it("takes the rest of the string when a quote is left open", () => {
    // Someone mid-type must see results narrow, not the whole query silently revert.
    expect(parseQuery('tag:"reading li').tags).toEqual([{ value: "reading li", negated: false }]);
  });

  it("falls back to a plain word for anything that only looks like an operator", () => {
    // Matching nothing here would read as missing data rather than an unknown operator.
    const parsed = parseQuery("colour:blue is:sideways");
    expect(parsed.words.map((w) => w.value)).toEqual(["colour:blue", "is:sideways"]);
    expect(parsed.flags).toEqual([]);
  });

  it("accepts host: as a synonym for site:", () => {
    expect(parseQuery("host:rust-lang.org").sites).toEqual([
      { value: "rust-lang.org", negated: false },
    ]);
  });
});

describe("matchesQuery — plain words", () => {
  it("searches title, url, description and tags", () => {
    expect(match("rust")).toBe(true);
    expect(match("ch01")).toBe(true);
    expect(match("reading")).toBe(true);
    expect(match("haskell")).toBe(false);
  });

  it("ANDs every word", () => {
    // "rust" is in the title, "book" in the URL — different fields, both required.
    expect(match("rust book")).toBe(true);
    expect(match("rust haskell")).toBe(false);
  });

  it("requires a quoted phrase to appear in one field, not across two", () => {
    expect(match('"the book"')).toBe(true); // the description, verbatim
    expect(match('"rust book"')).toBe(false); // spread across title and URL
  });

  it("is case-insensitive", () => {
    expect(match("RUST")).toBe(true);
  });
});

describe("matchesQuery — operators", () => {
  it("matches tags descendant-inclusively", () => {
    // The same rule the sidebar uses, so tag:dev finds dev/rust (§3.3.2).
    expect(match("tag:dev")).toBe(true);
    expect(match("tag:dev/rust")).toBe(true);
    expect(match("tag:dev/go")).toBe(false);
  });

  it("ANDs repeated tags — the reason the syntax exists", () => {
    expect(match('tag:dev tag:"reading list"')).toBe(true);
    expect(match("tag:dev tag:cooking")).toBe(false);
  });

  it("matches a substring of the host, not the whole URL", () => {
    expect(match("site:rust-lang.org")).toBe(true);
    expect(match("site:doc.rust-lang.org")).toBe(true);
    // "book" appears in the path, so a URL-wide match would wrongly succeed here.
    expect(match("site:book")).toBe(false);
  });

  it("survives a URL that cannot be parsed", () => {
    expect(match("site:example.com", { url: "not a url" })).toBe(false);
  });

  it("filters on is:pinned and is:untagged", () => {
    expect(match("is:pinned")).toBe(false);
    expect(match("is:pinned", { pinned: true })).toBe(true);
    expect(match("is:untagged")).toBe(false);
    expect(match("is:untagged", { tags: [] })).toBe(true);
  });

  it("negates every clause type", () => {
    expect(match("-tag:dev")).toBe(false);
    expect(match("-tag:cooking")).toBe(true);
    expect(match("-site:rust-lang.org")).toBe(false);
    expect(match("-is:pinned")).toBe(true);
    expect(match("-haskell")).toBe(true);
  });

  it("combines operators and words", () => {
    expect(match("tag:dev site:rust-lang.org -is:pinned book")).toBe(true);
    expect(match("tag:dev site:rust-lang.org is:pinned book")).toBe(false);
  });
});
