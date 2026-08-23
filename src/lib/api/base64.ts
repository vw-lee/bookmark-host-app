/**
 * Base64 for the GitHub Contents API (README §4.2).
 *
 * btoa() throws on any character outside Latin-1, so a single emoji or accented character in a
 * page title would break every write if the string were passed to it directly. Everything goes
 * through TextEncoder/TextDecoder instead.
 *
 * The chunking is not decoration: String.fromCharCode(...bytes) spreads the whole array onto
 * the call stack and blows up somewhere around 100k arguments — which a real bookmark file
 * would reach.
 */

const CHUNK = 0x8000; // 32 KiB per call, comfortably below any engine's argument limit

/** UTF-8 string -> base64. Safe for any Unicode input. */
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * base64 -> UTF-8 string.
 *
 * The GitHub API returns base64 wrapped at 60 characters, so newlines are stripped before
 * decoding; atob rejects them.
 */
export function decodeBase64(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
