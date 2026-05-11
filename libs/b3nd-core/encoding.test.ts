/**
 * Tests for encoding primitives — base64 and hex round-trips.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  decodeBase64,
  decodeHex,
  encodeBase64,
  encodeHex,
} from "./encoding.ts";

// ── hex ─────────────────────────────────────────────────────────────

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

Deno.test("encodeHex - always produces lowercase hex", () => {
  const hex = encodeHex(new Uint8Array([0xab, 0xcd, 0xef]));
  assertEquals(hex, "abcdef");
  assertEquals(hex, hex.toLowerCase());
});

Deno.test("decodeHex - empty string produces empty Uint8Array", () => {
  assertEquals(decodeHex("").length, 0);
});

Deno.test("decodeHex - accepts mixed case", () => {
  assertEquals(decodeHex("CaFeBaBe"), new Uint8Array([0xca, 0xfe, 0xba, 0xbe]));
});

Deno.test("decodeHex - odd-length string throws", () => {
  assertThrows(() => decodeHex("abc"), Error, "Invalid hex input");
});

Deno.test("hex round-trip - all 256 byte values", () => {
  const allBytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) allBytes[i] = i;
  assertEquals(decodeHex(encodeHex(allBytes)), allBytes);
});

// ── base64 ──────────────────────────────────────────────────────────

Deno.test("encodeBase64 - empty Uint8Array produces empty string", () => {
  assertEquals(encodeBase64(new Uint8Array([])), "");
});

Deno.test("encodeBase64 - 'Hello' encodes to known value", () => {
  assertEquals(encodeBase64(new TextEncoder().encode("Hello")), "SGVsbG8=");
});

Deno.test("encodeBase64 - 1 byte → 4 chars with == padding", () => {
  assertEquals(encodeBase64(new Uint8Array([0xff])), "/w==");
});

Deno.test("encodeBase64 - 3 bytes → 4 chars no padding", () => {
  assertEquals(encodeBase64(new Uint8Array([0x01, 0x02, 0x03])), "AQID");
});

Deno.test("decodeBase64 - empty string produces empty Uint8Array", () => {
  assertEquals(decodeBase64("").length, 0);
});

Deno.test("decodeBase64 - 'SGVsbG8=' decodes to 'Hello'", () => {
  assertEquals(new TextDecoder().decode(decodeBase64("SGVsbG8=")), "Hello");
});

Deno.test("base64 round-trip - all 256 byte values", () => {
  const allBytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) allBytes[i] = i;
  assertEquals(decodeBase64(encodeBase64(allBytes)), allBytes);
});

Deno.test("base64 round-trip - large payload (1KB)", () => {
  const data = crypto.getRandomValues(new Uint8Array(1024));
  assertEquals(decodeBase64(encodeBase64(data)), data);
});
