import { describe, it, expect } from "vitest";
import { tileFor, siteLabel, initialsFor, tileColor } from "./tile";

describe("siteLabel", () => {
  it("names the site, not the subdomain", () => {
    expect(siteLabel("news.ycombinator.com")).toBe("ycombinator");
    expect(siteLabel("developer.mozilla.org")).toBe("mozilla");
    expect(siteLabel("github.com")).toBe("github");
  });

  it("steps past a public second level", () => {
    expect(siteLabel("example.co.uk")).toBe("example");
    expect(siteLabel("bbc.co.uk")).toBe("bbc");
  });

  it("survives a hostname with no dot", () => {
    expect(siteLabel("localhost")).toBe("localhost");
  });
});

describe("initialsFor", () => {
  it("takes both initials of a multi-word label", () => {
    expect(initialsFor("rust-lang")).toBe("RL");
  });

  it("takes one letter from a single word rather than inventing an abbreviation", () => {
    expect(initialsFor("ycombinator")).toBe("Y");
  });

  it("handles non-Latin scripts without emitting a question mark", () => {
    expect(initialsFor("日本語")).toBe("日");
  });

  it("falls back rather than throwing on a label with no letters", () => {
    expect(initialsFor("---")).toBe("?");
  });
});

describe("tileFor", () => {
  it("is deterministic — the same site is the same colour every time", () => {
    expect(tileFor("https://rust-lang.org/x")).toEqual(tileFor("https://rust-lang.org/y"));
  });

  it("gives subdomains of one site the same colour", () => {
    const a = tileFor("https://developer.mozilla.org/");
    const b = tileFor("https://bugzilla.mozilla.org/");
    expect(a.hue).toBe(b.hue);
    // The host still reflects where the bookmark actually points.
    expect(a.host).not.toBe(b.host);
  });

  it("strips www from the displayed host", () => {
    expect(tileFor("https://www.github.com/a").host).toBe("github.com");
  });

  it("does not collide anagram-ish hosts onto one hue", () => {
    expect(tileFor("https://apple.com").hue).not.toBe(tileFor("https://appel.com").hue);
  });

  it("returns a renderable tile for a URL that will not parse", () => {
    expect(tileFor("not a url")).toEqual({ initials: "?", hue: 0, host: "" });
  });

  it("spreads hues across the wheel rather than clustering", () => {
    const hosts = ["a.com", "b.com", "c.com", "d.com", "e.com", "f.com", "g.com", "h.com"];
    const hues = hosts.map((h) => tileFor(`https://${h}`).hue);
    expect(new Set(hues).size).toBe(hosts.length);
  });
});

describe("tileColor", () => {
  it("uses a fixed perceptual lightness so white text keeps its contrast on every hue", () => {
    expect(tileColor(0)).toBe("oklch(0.48 0.14 0)");
    expect(tileColor(200)).toBe("oklch(0.48 0.14 200)");
  });
});
