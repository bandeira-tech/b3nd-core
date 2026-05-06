/**
 * Content-addressed storage and link utilities for B3nd
 *
 * @module hash
 *
 * Uses the `hash://` scheme where the hostname is the algorithm
 * and the path is the hex digest: `hash://sha256/{hex}`
 *
 * JSON payloads are canonicalized per RFC 8785 (JCS) before hashing,
 * ensuring deterministic hashes across implementations.
 *
 * @example
 * ```typescript
 * import { computeSha256, generateHashUri, hashValidator } from "@bandeira-tech/b3nd-sdk/hash";
 *
 * const data = { title: "Hello", content: "World" };
 * const hash = await computeSha256(data);
 * const uri = generateHashUri(hash);
 * // uri = "hash://sha256/2cf24dba..."
 *
 * // Use hashValidator in your schema
 * const schema = { "hash://sha256": hashValidator() };
 * ```
 */

import _canonicalize from "canonicalize";
// CJS/ESM interop: cast to callable
const canonicalize = _canonicalize as unknown as (
  input: unknown,
) => string | undefined;

/**
 * Compute SHA256 hash of a value.
 * - Uint8Array: hashes raw bytes
 * - Everything else: canonicalizes to RFC 8785 JSON, then hashes UTF-8 bytes
 *
 * @param value - The value to hash
 * @returns Hex-encoded SHA256 hash (64 characters)
 */
export async function computeSha256(
  value: Uint8Array | unknown,
): Promise<string> {
  let data: Uint8Array;

  if (value instanceof Uint8Array) {
    data = value;
  } else {
    const encoder = new TextEncoder();
    data = encoder.encode(canonicalize(value));
  }

  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    data as BufferSource,
  );
  const hashArray = new Uint8Array(hashBuffer);

  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a content-addressed URI from a SHA256 hash
 * @param hash - Hex-encoded SHA256 hash (64 characters)
 * @returns URI in format "hash://sha256/{hash}"
 */
export function generateHashUri(hash: string): string {
  return `hash://sha256/${hash}`;
}

/**
 * Parse a hash:// URI to extract algorithm and digest
 * @param uri - URI in format "hash://sha256/{hex}"
 * @returns Object with algorithm and hash, or null if invalid
 */
export function parseHashUri(
  uri: string,
): { algorithm: string; hash: string } | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== "hash:") return null;

    const algorithm = url.hostname;
    const hash = url.pathname.substring(1); // strip leading /
    if (!hash) return null;

    return { algorithm, hash };
  } catch {
    return null;
  }
}

/**
 * Validate that a value is a valid link (string URI)
 * @param value - The value to validate
 * @returns Validation result with valid boolean and optional error
 */
export function validateLinkValue(
  value: unknown,
): { valid: boolean; error?: string } {
  if (typeof value !== "string") {
    return { valid: false, error: "Link value must be a string URI" };
  }

  try {
    new URL(value);
  } catch {
    return { valid: false, error: "Link value must be a valid URI" };
  }

  return { valid: true };
}

/**
 * Generate a link URI for authenticated links
 * @param pubkey - Public key (hex) of the account
 * @param path - Path within the account namespace
 * @returns Link URI in format "link://accounts/{pubkey}/{path}"
 */
export function generateLinkUri(pubkey: string, path: string): string {
  return `link://accounts/${pubkey}/${path}`;
}

/**
 * Validate a SHA256 hash format
 * @param hash - Hash string to validate
 * @returns true if valid 64-character hex string
 */
export function isValidSha256Hash(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash);
}

/**
 * Schema validator factory for hash:// programs.
 * Verifies that content matches the hash in the URI.
 *
 * Uses the canonical Validator signature: (output, upstream, read)
 *
 * @example
 * ```typescript
 * import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";
 *
 * const schema = {
 *   "hash://sha256": hashValidator(),
 * };
 * ```
 */
export function hashValidator(): (
  output: [string, unknown],
  upstream: [string, unknown] | undefined,
  read: (uri: string) => Promise<{ success: boolean }>,
) => Promise<{ valid: boolean; error?: string }> {
  return async ([uri, value], _upstream, read) => {
    // Enforce write-once: reject if resource already exists
    const existing = await read(uri);
    if (existing.success) {
      return {
        valid: false,
        error: "hash:// is write-once: resource already exists",
      };
    }

    const result = await verifyHashContent(uri, value);
    return {
      valid: result.valid,
      error: result.error,
    };
  };
}

/**
 * Verify that content matches its hash:// URI
 * @param uri - Hash URI containing the expected digest
 * @param value - Content to verify
 * @returns Object with valid boolean and computed hash
 */
export async function verifyHashContent(
  uri: string,
  value: Uint8Array | unknown,
): Promise<
  { valid: boolean; expectedHash?: string; actualHash: string; error?: string }
> {
  const parsed = parseHashUri(uri);
  if (!parsed) {
    const actualHash = await computeSha256(value);
    return { valid: false, actualHash, error: "Invalid hash URI format" };
  }

  if (parsed.algorithm !== "sha256") {
    const actualHash = await computeSha256(value);
    return {
      valid: false,
      actualHash,
      error: `Unsupported algorithm: ${parsed.algorithm}`,
    };
  }

  const actualHash = await computeSha256(value);
  const valid = actualHash.toLowerCase() === parsed.hash.toLowerCase();

  return {
    valid,
    expectedHash: parsed.hash,
    actualHash,
    error: valid ? undefined : "Content hash mismatch",
  };
}
