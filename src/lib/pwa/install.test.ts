import { describe, it, expect } from "vitest";
import { readSharedLink } from "./install";

/**
 * Share-target field normalisation (task 5f).
 *
 * These cases are drawn from how real Android apps actually populate the share intent, which
 * is inconsistent enough that reading only `params.url` loses a large fraction of shares.
 */
describe("readSharedLink", () => {
  it("reads the url field when an app populates it properly", () => {
    const shared = readSharedLink("?url=https%3A%2F%2Fexample.com%2Fp&title=Example");
    expect(shared).toEqual({ url: "https://example.com/p", title: "Example" });
  });

  it("finds the URL in the text field, which many apps use instead", () => {
    const shared = readSharedLink("?text=https%3A%2F%2Fexample.com%2Fp");
    expect(shared?.url).toBe("https://example.com/p");
  });

  it("extracts the URL when an app packs title and URL together into text", () => {
    // Chrome on Android does this: "Page Title https://example.com/p"
    const shared = readSharedLink("?text=Some%20Article%20Title%20https%3A%2F%2Fexample.com%2Fp");
    expect(shared?.url).toBe("https://example.com/p");
    expect(shared?.title).toBe("Some Article Title");
  });

  it("prefers an explicit title over one derived from text", () => {
    const shared = readSharedLink("?title=Real%20Title&text=Junk%20https%3A%2F%2Fexample.com%2Fp");
    expect(shared?.title).toBe("Real Title");
  });

  it("falls back to the title field if that is where the URL landed", () => {
    const shared = readSharedLink("?title=https%3A%2F%2Fexample.com%2Fp");
    expect(shared?.url).toBe("https://example.com/p");
  });

  it("returns null when there is no URL anywhere", () => {
    expect(readSharedLink("?text=just%20some%20words")).toBeNull();
    expect(readSharedLink("")).toBeNull();
  });

  it("refuses a non-http scheme in a share payload", () => {
    // A share target is an untrusted entry point like any other (§5.4).
    expect(readSharedLink("?url=javascript%3Aalert(1)")).toBeNull();
    expect(readSharedLink("?text=data%3Atext%2Fhtml%2Chi")).toBeNull();
  });

  it("handles a URL with query parameters inside the text field", () => {
    const shared = readSharedLink("?text=Look%20https%3A%2F%2Fex.com%2Fp%3Fa%3D1%26b%3D2");
    expect(shared?.url).toBe("https://ex.com/p?a=1&b=2");
  });

  it("caps a runaway title", () => {
    const long = "x".repeat(900);
    const shared = readSharedLink(`?title=${long}&url=https%3A%2F%2Fexample.com`);
    expect(shared!.title.length).toBe(500);
  });
});
