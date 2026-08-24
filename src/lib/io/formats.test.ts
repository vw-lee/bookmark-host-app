import { describe, it, expect } from "vitest";
import {
  detectFormat,
  parseRaindrop,
  parsePocket,
  parsePinboard,
  parseGenericJson,
  parseCsv,
  parseCsvRows,
} from "./formats";

describe("detectFormat", () => {
  it("recognises each format by shape, not filename", () => {
    expect(detectFormat("<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>")).toBe("netscape");
    expect(detectFormat(JSON.stringify({ list: {} }))).toBe("pocket");
    expect(detectFormat(JSON.stringify([{ link: "https://a.test" }]))).toBe("raindrop");
    expect(detectFormat(JSON.stringify([{ href: "https://a.test" }]))).toBe("pinboard");
    expect(detectFormat("url,title\nhttps://a.test,A")).toBe("csv");
  });

  it("falls back to generic json for an unrecognised object array", () => {
    expect(detectFormat(JSON.stringify([{ website: "https://a.test" }]))).toBe("json");
  });

  it("returns null for something it cannot place", () => {
    expect(detectFormat("just some prose")).toBeNull();
    expect(detectFormat("{ broken json")).toBeNull();
  });
});

describe("parseRaindrop (4c)", () => {
  it("reads the link field and collection as a tag", () => {
    const json = JSON.stringify([
      {
        link: "https://rust-lang.org",
        title: "Rust",
        excerpt: "Systems language",
        tags: ["Dev", "lang"],
        collection: "Programming",
        created: "2024-01-15T10:00:00Z",
      },
    ]);
    const { parsed } = parseRaindrop(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.url).toBe("https://rust-lang.org");
    expect(parsed[0]!.description).toBe("Systems language");
    expect(parsed[0]!.tags).toEqual(["dev", "lang", "programming"]);
    expect(parsed[0]!.createdAt).toBe("2024-01-15T10:00:00.000Z");
  });

  it("accepts the { items: [...] } wrapper form", () => {
    const json = JSON.stringify({ items: [{ link: "https://a.test", title: "A" }] });
    expect(parseRaindrop(json).parsed).toHaveLength(1);
  });

  it("rejects unsafe URLs like every other importer", () => {
    const json = JSON.stringify([{ link: "javascript:alert(1)", title: "Bad" }]);
    const { parsed, rejected } = parseRaindrop(json);
    expect(parsed).toHaveLength(0);
    expect(rejected[0]!.reason).toBe("unsupported scheme");
  });
});

describe("parsePocket (4c)", () => {
  const POCKET = JSON.stringify({
    list: {
      "123": {
        given_url: "https://example.com/given",
        resolved_url: "https://example.com/resolved",
        resolved_title: "Resolved Title",
        excerpt: "Summary",
        time_added: "1600000000",
        tags: { rust: {}, async: {} },
      },
    },
  });

  it("prefers the resolved URL and title", () => {
    const { parsed } = parsePocket(POCKET);
    expect(parsed[0]!.url).toBe("https://example.com/resolved");
    expect(parsed[0]!.title).toBe("Resolved Title");
  });

  it("reads Pocket's object-keyed tags", () => {
    expect(parsePocket(POCKET).parsed[0]!.tags).toEqual(["async", "rust"]);
  });

  it("converts epoch seconds to ISO", () => {
    expect(parsePocket(POCKET).parsed[0]!.createdAt).toBe("2020-09-13T12:26:40.000Z");
  });

  it("handles an empty list", () => {
    expect(parsePocket(JSON.stringify({ list: {} })).parsed).toEqual([]);
  });
});

describe("parsePinboard (4c)", () => {
  it("maps Pinboard's confusing field names correctly", () => {
    // In Pinboard, `description` is the TITLE and `extended` is the note.
    const json = JSON.stringify([
      {
        href: "https://example.com/p",
        description: "The Title",
        extended: "The longer note",
        tags: "rust async",
        time: "2024-01-15T10:00:00Z",
      },
    ]);
    const { parsed } = parsePinboard(json);
    expect(parsed[0]!.title).toBe("The Title");
    expect(parsed[0]!.description).toBe("The longer note");
    expect(parsed[0]!.tags).toEqual(["async", "rust"]);
  });
});

describe("parseGenericJson", () => {
  it("round-trips our own export shape", () => {
    const json = JSON.stringify({
      bookmarks: [
        { url: "https://a.test", title: "A", description: "d", tags: ["x"], createdAt: "2024-01-15T10:00:00Z" },
      ],
    });
    const { parsed } = parseGenericJson(json);
    expect(parsed[0]!.title).toBe("A");
    expect(parsed[0]!.tags).toEqual(["x"]);
  });

  it("accepts url, link, or href as the address field", () => {
    const json = JSON.stringify([
      { url: "https://a.test" },
      { link: "https://b.test" },
      { href: "https://c.test" },
    ]);
    expect(parseGenericJson(json).parsed).toHaveLength(3);
  });
});

describe("parseCsvRows", () => {
  it("handles quoted fields with embedded commas and newlines", () => {
    const rows = parseCsvRows('a,"b,c",d\n1,"line1\nline2",3\n');
    expect(rows[0]).toEqual(["a", "b,c", "d"]);
    expect(rows[1]).toEqual(["1", "line1\nline2", "3"]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsvRows('"say ""hi""",x')[0]).toEqual(['say "hi"', "x"]);
  });

  it("tolerates CRLF and a missing trailing newline", () => {
    expect(parseCsvRows("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("skips blank lines", () => {
    expect(parseCsvRows("a,b\n\n1,2\n")).toHaveLength(2);
  });
});

describe("parseCsv", () => {
  it("finds columns by header name in any order", () => {
    const csv = 'title,tags,url\n"My Page","dev, rust",https://example.com/p\n';
    const { parsed } = parseCsv(csv);
    expect(parsed[0]!.url).toBe("https://example.com/p");
    expect(parsed[0]!.title).toBe("My Page");
    expect(parsed[0]!.tags).toEqual(["dev", "rust"]);
  });

  it("returns nothing when there is no url column", () => {
    expect(parseCsv("name,note\na,b\n").parsed).toEqual([]);
  });

  it("returns nothing for a header-only file", () => {
    expect(parseCsv("url,title\n").parsed).toEqual([]);
  });

  it("rejects unsafe URLs from CSV too", () => {
    const { parsed, rejected } = parseCsv("url\njavascript:alert(1)\n");
    expect(parsed).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it("falls back to the hostname when the title column is empty", () => {
    expect(parseCsv("url,title\nhttps://example.com/p,\n").parsed[0]!.title).toBe("example.com");
  });
});
