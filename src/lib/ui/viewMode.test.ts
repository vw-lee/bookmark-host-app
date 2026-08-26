import { describe, it, expect, beforeEach } from "vitest";
import { view, pageSizeFor, VIEW_MODES } from "./viewMode.svelte";

describe("pageSizeFor", () => {
  it("gives each mode a screenful rather than one fixed count", () => {
    expect(pageSizeFor("list")).toBe(50);
    expect(pageSizeFor("cards")).toBe(24);
    expect(pageSizeFor("tiles")).toBe(60);
    expect(pageSizeFor("table")).toBe(50);
  });

  it("never returns a page size that would render nothing", () => {
    for (const mode of VIEW_MODES) expect(pageSizeFor(mode)).toBeGreaterThan(0);
  });
});

describe("view store", () => {
  beforeEach(() => {
    localStorage.clear();
    view.set("list");
  });

  it("defaults to list", () => {
    expect(view.current).toBe("list");
  });

  it("persists a non-default mode", () => {
    view.set("cards");
    expect(localStorage.getItem("bm.view")).toBe("cards");
  });

  it("clears the key for the default rather than storing it", () => {
    view.set("cards");
    view.set("list");
    expect(localStorage.getItem("bm.view")).toBeNull();
  });

  it("cycles through every mode and returns to the start", () => {
    const seen = VIEW_MODES.map(() => {
      const at = view.current;
      view.next();
      return at;
    });
    expect(seen).toEqual([...VIEW_MODES]);
    expect(view.current).toBe("list");
  });

  it("reports the page size of the current mode", () => {
    view.set("tiles");
    expect(view.pageSize).toBe(60);
  });
});
