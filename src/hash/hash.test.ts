/**
 * Tests for b3nd-hash module — content-addressed storage and link utilities.
 *
 * Covers: computeSha256, generateHashUri, parseHashUri, isValidSha256Hash,
 * validateLinkValue, generateLinkUri, verifyHashContent, hashValidator
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  computeSha256,
  generateHashUri,
  generateLinkUri,
  hashValidator,
  isValidSha256Hash,
  parseHashUri,
  validateLinkValue,
  verifyHashContent,
} from "./hash.ts";

// ---------- computeSha256 ----------

Deno.test("computeSha256 — JSON object produces 64-char hex", async () => {
  const hash = await computeSha256({ hello: "world" });
  assertEquals(hash.length, 64);
  assertEquals(/^[a-f0-9]{64}$/.test(hash), true);
});

Deno.test("computeSha256 — same object always produces same hash (deterministic via RFC 8785)", async () => {
  const a = await computeSha256({ b: 2, a: 1 });
  const b = await computeSha256({ a: 1, b: 2 });
  assertEquals(
    a,
    b,
    "canonicalization must produce identical hashes regardless of key order",
  );
});

Deno.test("computeSha256 — different objects produce different hashes", async () => {
  const a = await computeSha256({ x: 1 });
  const b = await computeSha256({ x: 2 });
  assertEquals(a !== b, true);
});

Deno.test("computeSha256 — Uint8Array input hashes raw bytes", async () => {
  const data = new Uint8Array([1, 2, 3, 4]);
  const hash = await computeSha256(data);
  assertEquals(hash.length, 64);
  assertEquals(/^[a-f0-9]{64}$/.test(hash), true);
});

Deno.test("computeSha256 — string input is canonicalized as JSON", async () => {
  const hash = await computeSha256("hello");
  assertEquals(hash.length, 64);
  // String "hello" canonicalized is "\"hello\"", not raw "hello"
  const rawBytes = new TextEncoder().encode('"hello"');
  const rawHash = await computeSha256Bytes(rawBytes);
  assertEquals(
    hash,
    rawHash,
    "string should be canonicalized to JSON string with quotes",
  );
});

Deno.test("computeSha256 — number input", async () => {
  const hash = await computeSha256(42);
  assertEquals(hash.length, 64);
});

Deno.test("computeSha256 — null input", async () => {
  const hash = await computeSha256(null);
  assertEquals(hash.length, 64);
});

Deno.test("computeSha256 — nested object is deterministic", async () => {
  const obj = { outer: { inner: [1, 2, 3], key: "value" } };
  const a = await computeSha256(obj);
  const b = await computeSha256(obj);
  assertEquals(a, b);
});

// Helper: compute sha256 of raw bytes via crypto.subtle
async function computeSha256Bytes(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(data),
  );
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------- generateHashUri / parseHashUri ----------

Deno.test("generateHashUri — produces correct format", () => {
  const hash = "a".repeat(64);
  const uri = generateHashUri(hash);
  assertEquals(uri, `hash://sha256/${"a".repeat(64)}`);
});

Deno.test("parseHashUri — roundtrip with generateHashUri", () => {
  const hash = "abcdef1234567890".repeat(4);
  const uri = generateHashUri(hash);
  const parsed = parseHashUri(uri);
  assertExists(parsed);
  assertEquals(parsed.algorithm, "sha256");
  assertEquals(parsed.hash, hash);
});

Deno.test("parseHashUri — returns null for non-hash URI", () => {
  assertEquals(parseHashUri("mutable://foo/bar"), null);
  assertEquals(parseHashUri("https://example.com"), null);
});

Deno.test("parseHashUri — returns null for invalid URI", () => {
  assertEquals(parseHashUri("not a uri"), null);
});

Deno.test("parseHashUri — returns null for hash URI with no path", () => {
  assertEquals(parseHashUri("hash://sha256"), null);
  assertEquals(parseHashUri("hash://sha256/"), null);
});

// ---------- isValidSha256Hash ----------

Deno.test("isValidSha256Hash — valid 64-char hex", () => {
  assertEquals(isValidSha256Hash("a".repeat(64)), true);
  assertEquals(isValidSha256Hash("0123456789abcdef".repeat(4)), true);
});

Deno.test("isValidSha256Hash — case insensitive", () => {
  assertEquals(isValidSha256Hash("A".repeat(64)), true);
  assertEquals(
    isValidSha256Hash("aAbBcCdDeEfF0123456789".padEnd(64, "0")),
    true,
  );
});

Deno.test("isValidSha256Hash — rejects wrong length", () => {
  assertEquals(isValidSha256Hash("a".repeat(63)), false);
  assertEquals(isValidSha256Hash("a".repeat(65)), false);
  assertEquals(isValidSha256Hash(""), false);
});

Deno.test("isValidSha256Hash — rejects non-hex chars", () => {
  assertEquals(isValidSha256Hash("g".repeat(64)), false);
  assertEquals(isValidSha256Hash("z".repeat(64)), false);
});

// ---------- validateLinkValue ----------

Deno.test("validateLinkValue — valid URI string", () => {
  const result = validateLinkValue("https://example.com/path");
  assertEquals(result.valid, true);
  assertEquals(result.error, undefined);
});

Deno.test("validateLinkValue — valid mutable URI", () => {
  const result = validateLinkValue("mutable://foo/bar");
  assertEquals(result.valid, true);
});

Deno.test("validateLinkValue — rejects non-string", () => {
  assertEquals(validateLinkValue(42).valid, false);
  assertEquals(validateLinkValue(null).valid, false);
  assertEquals(validateLinkValue({ uri: "foo" }).valid, false);
});

Deno.test("validateLinkValue — rejects invalid URI string", () => {
  const result = validateLinkValue("not a valid uri");
  assertEquals(result.valid, false);
  assertExists(result.error);
});

// ---------- generateLinkUri ----------

Deno.test("generateLinkUri — produces correct format", () => {
  const pubkey = "abc123";
  const path = "profile/avatar";
  const uri = generateLinkUri(pubkey, path);
  assertEquals(uri, "link://accounts/abc123/profile/avatar");
});

// ---------- verifyHashContent ----------

Deno.test("verifyHashContent — matching content returns valid", async () => {
  const data = { title: "test", content: "hello" };
  const hash = await computeSha256(data);
  const uri = generateHashUri(hash);

  const result = await verifyHashContent(uri, data);
  assertEquals(result.valid, true);
  assertEquals(result.actualHash, hash);
  assertEquals(result.expectedHash, hash);
  assertEquals(result.error, undefined);
});

Deno.test("verifyHashContent — mismatched content returns invalid", async () => {
  const data = { title: "test" };
  const hash = await computeSha256(data);
  const uri = generateHashUri(hash);

  const result = await verifyHashContent(uri, { title: "different" });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Content hash mismatch");
  assertEquals(result.expectedHash, hash);
  assertEquals(result.actualHash !== hash, true);
});

Deno.test("verifyHashContent — invalid URI format", async () => {
  const result = await verifyHashContent("not-a-uri", { foo: 1 });
  assertEquals(result.valid, false);
  assertExists(result.error);
});

Deno.test("verifyHashContent — unsupported algorithm", async () => {
  const result = await verifyHashContent("hash://md5/abc123", { foo: 1 });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Unsupported algorithm: md5");
});

Deno.test("verifyHashContent — Uint8Array content verification", async () => {
  const data = new Uint8Array([10, 20, 30]);
  const hash = await computeSha256(data);
  const uri = generateHashUri(hash);

  const result = await verifyHashContent(uri, data);
  assertEquals(result.valid, true);
});

// ---------- hashValidator ----------

Deno.test("hashValidator — accepts valid write-once content", async () => {
  const data = { msg: "store me" };
  const hash = await computeSha256(data);
  const uri = generateHashUri(hash);

  const validator = hashValidator();
  const result = await validator(
    [uri, data],
    undefined,
    (_uri: string) => Promise.resolve({ success: false as const }),
  );

  assertEquals(result.valid, true);
});

Deno.test("hashValidator — rejects duplicate write (write-once)", async () => {
  const data = { msg: "already stored" };
  const hash = await computeSha256(data);
  const uri = generateHashUri(hash);

  const validator = hashValidator();
  const result = await validator(
    [uri, data],
    undefined,
    (_uri: string) => Promise.resolve({ success: true as const }),
  );

  assertEquals(result.valid, false);
  assertExists(result.error);
  assertEquals(result.error!.includes("write-once"), true);
});

Deno.test("hashValidator — rejects content that doesn't match hash", async () => {
  const realData = { msg: "real" };
  const hash = await computeSha256(realData);
  const uri = generateHashUri(hash);

  const validator = hashValidator();
  const result = await validator(
    [uri, { msg: "tampered" }],
    undefined,
    (_uri: string) => Promise.resolve({ success: false as const }),
  );

  assertEquals(result.valid, false);
  assertExists(result.error);
});

// ---------- End-to-end: content-addressed workflow ----------

Deno.test("e2e — content-addressed store-and-verify workflow", async () => {
  // 1. Compute hash of content
  const content = {
    type: "article",
    title: "B3nd",
    body: "Decentralized infrastructure",
  };
  const hash = await computeSha256(content);

  // 2. Generate URI
  const uri = generateHashUri(hash);
  assertEquals(uri.startsWith("hash://sha256/"), true);

  // 3. Validate hash format
  assertEquals(isValidSha256Hash(hash), true);

  // 4. Parse URI back
  const parsed = parseHashUri(uri);
  assertExists(parsed);
  assertEquals(parsed.algorithm, "sha256");
  assertEquals(parsed.hash, hash);

  // 5. Verify content matches
  const verification = await verifyHashContent(uri, content);
  assertEquals(verification.valid, true);

  // 6. Tampered content fails
  const tampered = { ...content, body: "Modified" };
  const tamperedVerification = await verifyHashContent(uri, tampered);
  assertEquals(tamperedVerification.valid, false);
});
