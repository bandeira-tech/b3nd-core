import { encodeHex } from "../b3nd-core/encoding.ts";

/**
 * Derive a deterministic obfuscated path from arbitrary parts.
 * Uses HMAC-SHA256 over the pipe-joined parts, returns a hex string.
 */
export async function deriveObfuscatedPath(
  secret: string,
  ...parts: string[]
): Promise<string> {
  const encoder = new TextEncoder();
  const input = parts.join("|");

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(input),
  );
  return encodeHex(new Uint8Array(signature)).substring(0, 32);
}
