/**
 * @module
 * Encoding primitives — pure `bytes ↔ string` conversions.
 *
 * Framework-level infrastructure used by crypto primitives (identity,
 * encrypt) and any other consumer that needs a stable byte/string
 * representation. Knows nothing about JSON, markers, or content.
 */

/** Encode bytes to lowercase hex. */
export function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Decode hex (any case) to bytes. Throws on odd-length input. */
export function decodeHex(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex input");
  }
  const buffer = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/** Encode bytes to base64 (Node Buffer-backed when available, btoa otherwise). */
export function encodeBase64(bytes: Uint8Array): string {
  const buf = nodeBuffer();
  if (buf) return buf.from(bytes).toString("base64");
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

/** Decode base64 to bytes. */
export function decodeBase64(b64: string): Uint8Array {
  const buf = nodeBuffer();
  if (buf) return new Uint8Array(buf.from(b64, "base64"));
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

interface NodeBuffer {
  from: (
    input: Uint8Array | string,
    encoding?: string,
  ) => { toString: (encoding: string) => string } & Uint8Array;
}

function nodeBuffer(): NodeBuffer | undefined {
  return (typeof globalThis !== "undefined" &&
    (globalThis as { Buffer?: NodeBuffer }).Buffer) || undefined;
}
