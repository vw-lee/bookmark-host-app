import { describe, it, expect } from "vitest";
import { encodeBase64, decodeBase64 } from "./base64";

describe("base64 round-trip (§4.2)", () => {
  it("handles plain ASCII", () => {
    expect(decodeBase64(encodeBase64("hello world"))).toBe("hello world");
  });

  it("handles the emoji and CJK fixture that breaks naive btoa", () => {
    // This is the regression the README calls out as the most likely day-one bug: btoa()
    // throws InvalidCharacterError on any of these.
    const fixture = "📚 Bookmarks — 書籍 · café · Ω≈ç√ · 🇬🇧 · \u{1F926}\u{1F3FC}‍♂️";
    expect(decodeBase64(encodeBase64(fixture))).toBe(fixture);
  });

  it("proves the naive approach would have thrown", () => {
    expect(() => btoa("📚")).toThrow();
    expect(() => encodeBase64("📚")).not.toThrow();
  });

  it("survives a payload past the call-stack chunking boundary", () => {
    // 200k characters of multi-byte text — well past the 32 KiB chunk, and past the argument
    // limit that an unchunked String.fromCharCode(...bytes) would hit.
    const big = "é🎯".repeat(100_000);
    const round = decodeBase64(encodeBase64(big));
    expect(round).toBe(big);
    expect(round.length).toBe(big.length);
  });

  it("tolerates the wrapped base64 GitHub actually returns", () => {
    // The Contents API wraps its base64 at 60 characters; atob rejects the newlines.
    const raw = encodeBase64("a".repeat(500));
    const wrapped = raw.replace(/(.{60})/g, "$1\n");
    expect(wrapped).toContain("\n");
    expect(decodeBase64(wrapped)).toBe("a".repeat(500));
  });

  it("round-trips an empty string", () => {
    expect(decodeBase64(encodeBase64(""))).toBe("");
  });
});
