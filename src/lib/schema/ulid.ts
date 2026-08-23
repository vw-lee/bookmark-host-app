/**
 * Minimal ULID generator (§3.1).
 *
 * Chosen over crypto.randomUUID() because ULIDs sort by creation time, which lets the
 * deterministic serializer order records meaningfully — and because randomUUID requires a
 * secure context, which ULID does not.
 *
 * Implemented here rather than pulled from npm to keep the dependency surface minimal (§5.4).
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32, no I/L/O/U
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // globalThis.crypto exists in browsers and in Node >=19.
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

function encodeTime(now: number): string {
  let out = "";
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = now % 32;
    out = ENCODING[mod] + out;
    now = (now - mod) / 32;
  }
  return out;
}

function encodeRandom(): string {
  const bytes = randomBytes(RANDOM_LEN);
  let out = "";
  for (let i = 0; i < RANDOM_LEN; i++) out += ENCODING[bytes[i]! % 32];
  return out;
}

export function ulid(seedTime: number = Date.now()): string {
  return encodeTime(seedTime) + encodeRandom();
}

const ULID_RE = new RegExp(`^[${ENCODING}]{${TIME_LEN + RANDOM_LEN}}$`);

export function isUlid(value: string): boolean {
  return ULID_RE.test(value);
}
