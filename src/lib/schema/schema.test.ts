import { describe, it, expect } from "vitest";
import { parseBookmarkFile, SchemaError } from "./schema";
import { migrate, needsMigration, MigrationError } from "./migrate";
import { serialize } from "./serialize";
import { emptyFile, SCHEMA_VERSION } from "./types";
import { ulid, isUlid } from "./ulid";
import type { Bookmark } from "./types";

function bookmark(over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "01J8XQ2K7M3N4P5R6S7T8V9W0X",
    url: "https://example.com/page",
    urlKey: "example.com/page",
    title: "Example",
    description: "",
    notes: "",
    tags: ["tools"],
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

describe("ulid (§3.1)", () => {
  it("produces 26-character Crockford base32", () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
  });

  it("sorts lexicographically by creation time", () => {
    const early = ulid(1_000_000_000_000);
    const late = ulid(2_000_000_000_000);
    expect(early < late).toBe(true);
  });

  it("does not collide across a large batch", () => {
    const ids = new Set(Array.from({ length: 5000 }, () => ulid()));
    expect(ids.size).toBe(5000);
  });
});

describe("parseBookmarkFile (§3.1)", () => {
  it("accepts a well-formed file", () => {
    const file = { ...emptyFile("2026-08-20T08:00:00.000Z"), bookmarks: [bookmark()] };
    expect(parseBookmarkFile(file).bookmarks).toHaveLength(1);
  });

  it("rejects a truncated file with readable issues rather than throwing raw", () => {
    // The hand-edited / merge-conflicted case. Must be repairable, not a white screen.
    try {
      parseBookmarkFile({ schemaVersion: 2, bookmarks: "not an array" });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaError);
      const err = e as SchemaError;
      expect(err.issues.length).toBeGreaterThan(0);
      expect(err.issues.join(" ")).toContain("bookmarks");
    }
  });

  it("rejects a record missing updatedAt, since merge depends on it", () => {
    const broken = bookmark();
    delete (broken as Partial<Bookmark>).updatedAt;
    expect(() => parseBookmarkFile({ ...emptyFile(), bookmarks: [broken] })).toThrow(SchemaError);
  });

  it("rejects a non-ISO date", () => {
    expect(() =>
      parseBookmarkFile({ ...emptyFile(), bookmarks: [bookmark({ updatedAt: "yesterday" })] }),
    ).toThrow(SchemaError);
  });
});

describe("migrate (§3.1)", () => {
  it("lifts a v1 file, folding folder into tags", () => {
    const v1 = {
      version: "1.0",
      lastUpdated: "2026-08-20T08:00:00.000Z",
      tags: ["developer", "docs"],
      bookmarks: [
        {
          id: "b3a1c2d0-9f8e-4a1b-8c2d-3e4f5a6b7c8d",
          url: "https://example.com?utm_source=x",
          title: "Example Resource",
          description: "Short summary",
          tags: ["Tools"],
          folder: "Development",
          createdAt: "2026-08-20T08:00:00.000Z",
        },
      ],
    };

    const out = parseBookmarkFile(migrate(v1));
    expect(out.schemaVersion).toBe(SCHEMA_VERSION);

    const b = out.bookmarks[0]!;
    // Folder became a tag, and both were normalised to canonical lowercase (§3.3.3).
    expect(b.tags).toEqual(["development", "tools"]);
    // urlKey was derived, stripping the tracking parameter.
    expect(b.urlKey).toBe("example.com");
    // updatedAt seeded from createdAt — never inventing an edit that did not happen.
    expect(b.updatedAt).toBe(b.createdAt);
    expect(b.deletedAt).toBeNull();
    // The v1 top-level tag array is dropped; membership is derived.
    expect(out.tagMeta).toEqual({});
  });

  it("mints an id for a v1 record that lacks one", () => {
    const out = migrate({
      version: "1.0",
      bookmarks: [{ url: "https://a.test", createdAt: "2026-08-20T08:00:00.000Z" }],
    });
    const b = (out.bookmarks as Bookmark[])[0]!;
    expect(isUlid(b.id)).toBe(true);
  });

  it("is a no-op on a current file", () => {
    const file = { ...emptyFile("2026-08-20T08:00:00.000Z"), bookmarks: [bookmark()] };
    expect(migrate(file)).toEqual(file);
    expect(needsMigration(file)).toBe(false);
  });

  it("refuses a file from a NEWER build rather than damaging it", () => {
    // Two devices on different app versions is the realistic case. Writing a v2 shape over a
    // v3 file would silently destroy fields this build knows nothing about.
    expect(() => migrate({ schemaVersion: 99, bookmarks: [] })).toThrow(MigrationError);
  });

  it("rejects non-objects", () => {
    expect(() => migrate(null)).toThrow(MigrationError);
    expect(() => migrate("[]")).toThrow(MigrationError);
  });
});

describe("serialize (§3.1)", () => {
  it("is byte-stable regardless of input ordering", () => {
    const a = bookmark({ id: "01AAAAAAAAAAAAAAAAAAAAAAAA", tags: ["b", "a"] });
    const b = bookmark({ id: "01BBBBBBBBBBBBBBBBBBBBBBBB", tags: ["a", "b"] });
    const now = "2026-08-20T08:00:00.000Z";

    const one = serialize({ schemaVersion: 2, updatedAt: now, tagMeta: {}, bookmarks: [a, b] });
    const two = serialize({ schemaVersion: 2, updatedAt: now, tagMeta: {}, bookmarks: [b, a] });
    expect(one).toBe(two);
  });

  it("sorts tagMeta keys and omits undefined fields", () => {
    const out = serialize({
      schemaVersion: 2,
      updatedAt: "2026-08-20T08:00:00.000Z",
      tagMeta: { zeta: { order: 2 }, alpha: { label: "Alpha" } },
      bookmarks: [],
    });
    expect(out.indexOf('"alpha"')).toBeLessThan(out.indexOf('"zeta"'));
    expect(out).not.toContain("undefined");
  });

  it("uses two-space indent and ends with a newline", () => {
    const out = serialize(emptyFile("2026-08-20T08:00:00.000Z"));
    expect(out.endsWith("}\n")).toBe(true);
    expect(out).toContain('\n  "schemaVersion"');
  });

  it("survives a round-trip through JSON and validation", () => {
    const file = { ...emptyFile("2026-08-20T08:00:00.000Z"), bookmarks: [bookmark()] };
    const reparsed = parseBookmarkFile(JSON.parse(serialize(file)));
    expect(serialize(reparsed)).toBe(serialize(file));
  });
});
