/**
 * PIN-wrapped token storage (decision D13).
 *
 * WHAT THIS DEFENDS AGAINST, precisely — because overstating it would be worse than not
 * building it at all.
 *
 * D10 resolved as "no custom domain", so the app runs on `*.github.io`, an origin shared with
 * every other project on the account (§5.1). The realistic threat is a sibling page there —
 * an old demo, a half-finished experiment with an XSS hole — reading `localStorage`
 * opportunistically and walking away with a token that has write access to a private repo.
 * Against that, ciphertext is genuinely useful: the attacker gets a blob it cannot open.
 *
 * WHAT IT DOES NOT DEFEND AGAINST:
 *
 *   - XSS inside THIS app after unlock. Once decrypted, the token is in memory and reachable.
 *     Nothing client-side can prevent that.
 *   - A determined attacker who exfiltrates the blob and grinds it offline. A short PIN has
 *     little entropy; PBKDF2 raises the cost per guess but cannot manufacture secrecy that the
 *     PIN never had. Six digits at 600k iterations is hours of GPU time, not centuries.
 *
 * So: this converts "your token is sitting in plaintext for any sibling page to take" into
 * "an attacker must target this app specifically and then do work". That is a real improvement
 * and it is the whole of the claim.
 */

/** OWASP's PBKDF2-HMAC-SHA256 guidance. Costs roughly a third of a second in a browser. */
const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/**
 * Minimum secret length. Six is a floor, not a recommendation — the UI asks for a passphrase
 * and explains why length matters more than anything else here.
 */
export const MIN_PIN_LENGTH = 6;

export interface WrappedToken {
  v: 1;
  salt: string;
  iv: string;
  data: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function subtle(): SubtleCrypto {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) {
    throw new Error("This browser does not provide WebCrypto, so a PIN cannot be used.");
  }
  return crypto.subtle;
}

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await subtle().importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle().deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt a token under a PIN. The salt and IV are fresh on every call. */
export async function wrapToken(token: string, pin: string): Promise<WrappedToken> {
  if (pin.length < MIN_PIN_LENGTH) {
    throw new Error(`Use at least ${MIN_PIN_LENGTH} characters.`);
  }
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(pin, salt);

  const ciphertext = await subtle().encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(token),
  );

  return {
    v: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(ciphertext)),
  };
}

/**
 * Decrypt a token. Returns null for a wrong PIN.
 *
 * AES-GCM is authenticated, so a wrong key fails the tag check and throws rather than
 * returning plausible garbage — which is what makes "wrong PIN" detectable at all.
 */
export async function unwrapToken(wrapped: WrappedToken, pin: string): Promise<string | null> {
  try {
    const key = await deriveKey(pin, fromBase64(wrapped.salt));
    const plaintext = await subtle().decrypt(
      { name: "AES-GCM", iv: fromBase64(wrapped.iv) as BufferSource },
      key,
      fromBase64(wrapped.data) as BufferSource,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

export function isWrappedToken(value: unknown): value is WrappedToken {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<WrappedToken>;
  return (
    candidate.v === 1 &&
    typeof candidate.salt === "string" &&
    typeof candidate.iv === "string" &&
    typeof candidate.data === "string"
  );
}

export function cryptoAvailable(): boolean {
  return typeof globalThis.crypto?.subtle !== "undefined";
}
