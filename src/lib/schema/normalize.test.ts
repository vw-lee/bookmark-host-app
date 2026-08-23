import { describe, it, expect } from "vitest";
import {
  isSafeUrl,
  normalizeUrlKey,
  normalizeTag,
  normalizeTags,
  tagMatches,
  derivedTagNodes,
  cleanText,
} from "./normalize";

describe("isSafeUrl (§5.4)", () => {
  it("accepts http and https", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("http://example.com")).toBe(true);
  });

  it("rejects the schemes that would execute in our origin", () => {
    // The whole point: a saved bookmark must never be able to run script on click.
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("JavaScript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeUrl("vbscript:msgbox")).toBe(false);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeUrl("blob:https://example.com/x")).toBe(false);
  });

  it("rejects garbage rather than throwing", () => {
    expect(isSafeUrl("not a url")).toBe(false);
    expect(isSafeUrl("")).toBe(false);
  });
});

describe("normalizeUrlKey (§3.1)", () => {
  it("collapses scheme, www, case, and trailing slash", () => {
    const key = "example.com/page";
    expect(normalizeUrlKey("https://www.Example.com/page")).toBe(key);
    expect(normalizeUrlKey("http://example.com/page/")).toBe(key);
    expect(normalizeUrlKey("  https://EXAMPLE.com/page  ")).toBe(key);
  });

  it("strips tracking parameters but keeps meaningful ones", () => {
    expect(normalizeUrlKey("https://example.com/p?utm_source=x&id=7")).toBe("example.com/p?id=7");
    expect(normalizeUrlKey("https://example.com/p?fbclid=abc")).toBe("example.com/p");
    expect(normalizeUrlKey("https://example.com/p?gclid=abc&q=rust")).toBe("example.com/p?q=rust");
  });

  it("orders query parameters so equivalent URLs collapse", () => {
    expect(normalizeUrlKey("https://example.com/p?b=2&a=1")).toBe(
      normalizeUrlKey("https://example.com/p?a=1&b=2"),
    );
  });

  it("drops positional fragments but keeps SPA route fragments", () => {
    expect(normalizeUrlKey("https://example.com/p#section-2")).toBe("example.com/p");
    expect(normalizeUrlKey("https://example.com/app#/inbox")).toBe("example.com/app#/inbox");
  });

  it("keeps a non-default port", () => {
    expect(normalizeUrlKey("http://localhost:5173/x")).toBe("localhost:5173/x");
    expect(normalizeUrlKey("https://example.com:443/x")).toBe("example.com/x");
  });

  it("returns empty for unsafe or unparseable input, never throwing", () => {
    expect(normalizeUrlKey("javascript:alert(1)")).toBe("");
    expect(normalizeUrlKey("nonsense")).toBe("");
  });
});

describe("normalizeTag (§3.3.3)", () => {
  it("applies the worked example from the README verbatim", () => {
    expect(normalizeTag("  Dev // Web  Development /  Rust  ")).toBe("dev/web development/rust");
  });

  it("lowercases so case variants are one tag", () => {
    expect(normalizeTag("Dev/Rust")).toBe("dev/rust");
    expect(normalizeTag("DEV/RUST")).toBe("dev/rust");
  });

  it("NFC-normalises before lowercasing", () => {
    // "café" as precomposed U+00E9 vs decomposed e + U+0301. Without the NFC step these
    // become two distinct tags that look identical in the sidebar.
    const precomposed = "caf\u00e9";
    const decomposed = "cafe\u0301";
    expect(precomposed).not.toBe(decomposed);
    expect(normalizeTag(precomposed)).toBe(normalizeTag(decomposed));
  });

  it("collapses empty segments, leading and trailing slashes", () => {
    expect(normalizeTag("/dev/")).toBe("dev");
    expect(normalizeTag("dev//rust")).toBe("dev/rust");
    expect(normalizeTag("///")).toBe("");
  });

  it("keeps spaces inside segments rather than hyphenating", () => {
    expect(normalizeTag("Web Development")).toBe("web development");
  });

  it("strips angle brackets so a tag can never carry markup", () => {
    expect(normalizeTag("Evil<script>alert(1)</script>")).toBe("evilscriptalert(1)/script");
    expect(normalizeTag("a<b>c")).toBe("abc");
  });

  it("strips control characters", () => {
    expect(normalizeTag("de\u0000v/ru\u001fst")).toBe("dev/rust");
  });

  it("rejects tags past the depth, segment, and total limits", () => {
    expect(normalizeTag("a/b/c/d/e")).toBe("a/b/c/d/e");
    expect(normalizeTag("a/b/c/d/e/f")).toBe("");
    expect(normalizeTag("x".repeat(65))).toBe("");
    expect(normalizeTag("x".repeat(64))).toBe("x".repeat(64));
  });

  it("returns empty for blank input", () => {
    expect(normalizeTag("   ")).toBe("");
    expect(normalizeTag("")).toBe("");
  });
});

describe("normalizeTags", () => {
  it("deduplicates spelling variants and sorts", () => {
    expect(normalizeTags(["Dev", "dev", " DEV ", "rust"])).toEqual(["dev", "rust"]);
  });

  it("drops invalid entries instead of storing empties", () => {
    expect(normalizeTags(["ok", "", "///", "a/b/c/d/e/f"])).toEqual(["ok"]);
  });
});

describe("tagMatches (§3.3.2)", () => {
  it("matches the tag itself and its descendants", () => {
    expect(tagMatches("dev", "dev")).toBe(true);
    expect(tagMatches("dev/rust", "dev")).toBe(true);
    expect(tagMatches("dev/rust/async", "dev")).toBe(true);
  });

  it("does NOT match a sibling sharing a prefix", () => {
    // The bug a bare startsWith would introduce.
    expect(tagMatches("development", "dev")).toBe(false);
    expect(tagMatches("devops/ci", "dev")).toBe(false);
  });

  it("does not match an ancestor from a descendant selection", () => {
    expect(tagMatches("dev", "dev/rust")).toBe(false);
  });
});

describe("derivedTagNodes (§3.3.1)", () => {
  it("materialises ancestors that are not themselves stored", () => {
    expect(derivedTagNodes(["dev/rust/async"])).toEqual(["dev", "dev/rust", "dev/rust/async"]);
  });

  it("deduplicates shared ancestors across tags", () => {
    expect(derivedTagNodes(["dev/rust", "dev/go", "reading"])).toEqual([
      "dev",
      "dev/go",
      "dev/rust",
      "reading",
    ]);
  });

  it("returns nothing for an empty collection", () => {
    expect(derivedTagNodes([])).toEqual([]);
  });
});

describe("cleanText (§5.4)", () => {
  it("strips control characters and caps length", () => {
    expect(cleanText("hel\u0000lo", 100)).toBe("hello");
    expect(cleanText("abcdef", 3)).toBe("abc");
    expect(cleanText("  padded  ", 100)).toBe("padded");
  });
});
