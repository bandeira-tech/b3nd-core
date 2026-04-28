/**
 * Encoding Test Suite
 *
 * Comprehensive tests for hex and base64 encoding/decoding utilities.
 * Tests round-trip integrity, edge cases, and error handling.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  decodeBase64,
  decodeHex,
  encodeBase64,
  encodeHex,
} from "./encoding.ts";

// ============================================================================
// encodeHex / decodeHex
// ============================================================================

Deno.test("encodeHex - empty Uint8Array produces empty string", () => {
  assertEquals(encodeHex(new Uint8Array([])), "");
});

Deno.test("encodeHex - single byte zero pads to two chars", () => {
  assertEquals(encodeHex(new Uint8Array([0])), "00");
});

Deno.test("encodeHex - single byte max", () => {
  assertEquals(encodeHex(new Uint8Array([255])), "ff");
});

Deno.test("encodeHex - multiple bytes", () => {
  assertEquals(encodeHex(new Uint8Array([0xca, 0xfe, 0xba, 0xbe])), "cafebabe");
});

Deno.test("encodeHex - all byte values 0x00..0x0f are left-padded", () => {
  for (let i = 0; i < 16; i++) {
    const hex = encodeHex(new Uint8Array([i]));
    assertEquals(hex.length, 2, `byte ${i} should produce 2-char hex`);
    assertEquals(hex, i.toString(16).padStart(2, "0"));
  }
});

Deno.test("encodeHex - always produces lowercase hex", () => {
  const hex = encodeHex(new Uint8Array([0xab, 0xcd, 0xef]));
  assertEquals(hex, "abcdef");
  assertEquals(hex, hex.toLowerCase());
});

Deno.test("decodeHex - empty string produces empty Uint8Array", () => {
  const result = decodeHex("");
  assertEquals(result.length, 0);
});

Deno.test("decodeHex - valid lowercase hex", () => {
  const result = decodeHex("cafebabe");
  assertEquals(result, new Uint8Array([0xca, 0xfe, 0xba, 0xbe]));
});

Deno.test("decodeHex - valid uppercase hex", () => {
  const result = decodeHex("CAFEBABE");
  assertEquals(result, new Uint8Array([0xca, 0xfe, 0xba, 0xbe]));
});

Deno.test("decodeHex - mixed case hex", () => {
  const result = decodeHex("CaFeBaBe");
  assertEquals(result, new Uint8Array([0xca, 0xfe, 0xba, 0xbe]));
});

Deno.test("decodeHex - odd-length string throws", () => {
  assertThrows(
    () => decodeHex("abc"),
    Error,
    "Invalid hex input",
  );
});

Deno.test("hex round-trip - random 32-byte key", () => {
  const original = crypto.getRandomValues(new Uint8Array(32));
  const hex = encodeHex(original);
  const decoded = decodeHex(hex);
  assertEquals(decoded, original);
});

Deno.test("hex round-trip - all 256 byte values", () => {
  const allBytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) allBytes[i] = i;
  const hex = encodeHex(allBytes);
  assertEquals(hex.length, 512);
  const decoded = decodeHex(hex);
  assertEquals(decoded, allBytes);
});

Deno.test("hex round-trip - Ed25519 pubkey length (32 bytes)", () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const hex = encodeHex(key);
  assertEquals(hex.length, 64, "Ed25519 pubkey hex should be 64 chars");
  assertEquals(decodeHex(hex), key);
});

Deno.test("hex round-trip - Ed25519 signature length (64 bytes)", () => {
  const sig = crypto.getRandomValues(new Uint8Array(64));
  const hex = encodeHex(sig);
  assertEquals(hex.length, 128, "Ed25519 signature hex should be 128 chars");
  assertEquals(decodeHex(hex), sig);
});

// ============================================================================
// encodeBase64 / decodeBase64
// ============================================================================

Deno.test("encodeBase64 - empty Uint8Array produces empty string", () => {
  assertEquals(encodeBase64(new Uint8Array([])), "");
});

Deno.test("encodeBase64 - known value", () => {
  // "Hello" in base64 is "SGVsbG8="
  const bytes = new TextEncoder().encode("Hello");
  assertEquals(encodeBase64(bytes), "SGVsbG8=");
});

Deno.test("encodeBase64 - binary data with padding", () => {
  // 1 byte → 4 chars with == padding
  const result = encodeBase64(new Uint8Array([0xff]));
  assertEquals(result, "/w==");
});

Deno.test("encodeBase64 - binary data without padding (3 bytes)", () => {
  // 3 bytes → 4 chars, no padding
  const result = encodeBase64(new Uint8Array([0x01, 0x02, 0x03]));
  assertEquals(result, "AQID");
});

Deno.test("decodeBase64 - empty string produces empty Uint8Array", () => {
  const result = decodeBase64("");
  assertEquals(result.length, 0);
});

Deno.test("decodeBase64 - known value", () => {
  const result = decodeBase64("SGVsbG8=");
  const text = new TextDecoder().decode(result);
  assertEquals(text, "Hello");
});

Deno.test("base64 round-trip - random 64 bytes", () => {
  const original = crypto.getRandomValues(new Uint8Array(64));
  const b64 = encodeBase64(original);
  const decoded = decodeBase64(b64);
  assertEquals(decoded, original);
});

Deno.test("base64 round-trip - all 256 byte values", () => {
  const allBytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) allBytes[i] = i;
  const b64 = encodeBase64(allBytes);
  const decoded = decodeBase64(b64);
  assertEquals(decoded, allBytes);
});

Deno.test("base64 round-trip - large payload (1KB)", () => {
  const data = crypto.getRandomValues(new Uint8Array(1024));
  const b64 = encodeBase64(data);
  const decoded = decodeBase64(b64);
  assertEquals(decoded, data);
});

// ============================================================================
// Cross-format consistency
// ============================================================================

Deno.test("hex and base64 decode same original bytes", () => {
  const original = crypto.getRandomValues(new Uint8Array(48));
  const fromHex = decodeHex(encodeHex(original));
  const fromB64 = decodeBase64(encodeBase64(original));
  assertEquals(fromHex, fromB64);
  assertEquals(fromHex, original);
});
