import { describe, it, expect, beforeEach } from "vitest";
import { theme } from "./theme.svelte";

describe("theme (7b / D14)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-eink");
    theme.set("system");
  });

  it("defaults to following the system", () => {
    expect(theme.current).toBe("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("stamps the chosen theme onto the document", () => {
    theme.set("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("sets a separate data-eink flag, because e-ink changes behaviour not just colour", () => {
    theme.set("eink");
    expect(document.documentElement.getAttribute("data-theme")).toBe("eink");
    expect(document.documentElement.hasAttribute("data-eink")).toBe(true);
    expect(theme.isEink).toBe(true);
  });

  it("clears the e-ink flag when switching away", () => {
    theme.set("eink");
    theme.set("light");
    expect(document.documentElement.hasAttribute("data-eink")).toBe(false);
    expect(theme.isEink).toBe(false);
  });

  it("persists a choice and forgets 'system'", () => {
    theme.set("dark");
    expect(localStorage.getItem("bm.theme")).toBe("dark");
    theme.set("system");
    expect(localStorage.getItem("bm.theme")).toBeNull();
  });

  it("removes data-theme when returning to system", () => {
    theme.set("dark");
    theme.set("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
