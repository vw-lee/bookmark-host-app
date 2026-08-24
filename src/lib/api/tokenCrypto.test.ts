import { describe, it, expect } from "vitest";
import {
  wrapToken,
  unwrapToken,
  isWrappedToken,
  cryptoAvailable,
  MIN_PIN_LENGTH,
} from "./tokenCrypto";

const TOKEN = "github_pat_11ABCDEFG0abcdefghijklmnop_qrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV";
const PIN = "correct-horse";

describe("tokenCrypto (D13)", () => {
  it("is available in this environment", () => {
    expect(cryptoAvailable()).toBe(true);
  });

  it("round-trips a token", async () => {
    const wrapped = await wrapToken(TOKEN, PIN);
    expect(await unwrapToken(wrapped, PIN)).toBe(TOKEN);
  });

  it("never stores the token in the clear", async () => {
    const wrapped = await wrapToken(TOKEN, PIN);
    const serialized = JSON.stringify(wrapped);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain("github_pat");
    // Nor any recognisable run of it.
    expect(serialized).not.toContain(TOKEN.slice(0, 16));
  });

  it("returns null for a wrong PIN rather than garbage", async () => {
    // AES-GCM is authenticated, so a wrong key fails the tag check. Without that, a wrong PIN
    // would yield plausible-looking bytes and the app could not tell.
    const wrapped = await wrapToken(TOKEN, PIN);
    expect(await unwrapToken(wrapped, "wrong-passphrase")).toBeNull();
  });

  it("returns null for tampered ciphertext", async () => {
    const wrapped = await wrapToken(TOKEN, PIN);
    const flipped = { ...wrapped, data: wrapped.data.slice(0, -4) + "AAAA" };
    expect(await unwrapToken(flipped, PIN)).toBeNull();
  });

  it("returns null for a tampered IV", async () => {
    const wrapped = await wrapToken(TOKEN, PIN);
    const flipped = { ...wrapped, iv: wrapped.iv.slice(0, -4) + "AAAA" };
    expect(await unwrapToken(flipped, PIN)).toBeNull();
  });

  it("uses a fresh salt and IV every time", async () => {
    // Reusing either would leak that two stored tokens are identical, and IV reuse under the
    // same key breaks AES-GCM outright.
    const a = await wrapToken(TOKEN, PIN);
    const b = await wrapToken(TOKEN, PIN);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
    expect(await unwrapToken(a, PIN)).toBe(await unwrapToken(b, PIN));
  });

  it("refuses a secret shorter than the minimum", async () => {
    await expect(wrapToken(TOKEN, "12345")).rejects.toThrow();
    await expect(wrapToken(TOKEN, "")).rejects.toThrow();
  });

  it("accepts exactly the minimum length", async () => {
    const pin = "x".repeat(MIN_PIN_LENGTH);
    const wrapped = await wrapToken(TOKEN, pin);
    expect(await unwrapToken(wrapped, pin)).toBe(TOKEN);
  });

  it("handles a unicode passphrase", async () => {
    const pin = "café-📚-書籍";
    const wrapped = await wrapToken(TOKEN, pin);
    expect(await unwrapToken(wrapped, pin)).toBe(TOKEN);
    expect(await unwrapToken(wrapped, "cafe-📚-書籍")).toBeNull();
  });

  it("recognises its own envelope and rejects anything else", () => {
    expect(isWrappedToken({ v: 1, salt: "a", iv: "b", data: "c" })).toBe(true);
    expect(isWrappedToken({ v: 2, salt: "a", iv: "b", data: "c" })).toBe(false);
    expect(isWrappedToken({ salt: "a", iv: "b" })).toBe(false);
    expect(isWrappedToken("github_pat_plain")).toBe(false);
    expect(isWrappedToken(null)).toBe(false);
  });
});
