/**
 * Tests for the binary lib:
 *   - hex / base64 primitives
 *   - isBinary / isEncodedBinary predicates
 *   - encodeBinaryForJson / decodeBinaryFromJson round-trip
 */

import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import {
  decodeBase64,
  decodeBinaryFromJson,
  decodeHex,
  encodeBase64,
  encodeBinaryForJson,
  encodeHex,
  isBinary,
  isEncodedBinary,
} from "./mod.ts";

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

// ── isBinary / isEncodedBinary ──────────────────────────────────────

Deno.test("isBinary - Uint8Array is binary", () => {
  assertEquals(isBinary(new Uint8Array([1, 2, 3])), true);
});

Deno.test("isBinary - ArrayBuffer is binary", () => {
  assertEquals(isBinary(new ArrayBuffer(8)), true);
});

Deno.test("isBinary - plain object / null are not binary", () => {
  assertEquals(isBinary({ data: [1, 2, 3] }), false);
  assertEquals(isBinary(null), false);
});

Deno.test("isEncodedBinary - recognizes encoded binary marker objects", () => {
  assertEquals(
    isEncodedBinary(encodeBinaryForJson(new Uint8Array([1, 2, 3]))),
    true,
  );
});

Deno.test("isEncodedBinary - rejects plain objects / strings / null", () => {
  assertEquals(isEncodedBinary({ data: "hello" }), false);
  assertEquals(isEncodedBinary(null), false);
  assertEquals(isEncodedBinary("string"), false);
});

// ── encodeBinaryForJson / decodeBinaryFromJson ──────────────────────

Deno.test("encodeBinaryForJson - returns originals for non-hostile values", () => {
  assertEquals(encodeBinaryForJson("hello"), "hello");
  assertEquals(encodeBinaryForJson(42), 42);
  assertEquals(encodeBinaryForJson({ key: "val" }), { key: "val" });
  assertEquals(encodeBinaryForJson(null), null);
});

Deno.test("encodeBinaryForJson - encodes top-level Uint8Array", () => {
  const encoded = encodeBinaryForJson(new Uint8Array([0xca, 0xfe]));
  assertEquals(isEncodedBinary(encoded), true);
  assertEquals(typeof (encoded as { data: string }).data, "string");
});

Deno.test("encodeBinaryForJson - encodes ArrayBuffer", () => {
  const buf = new Uint8Array([0xde, 0xad]).buffer;
  assertEquals(isEncodedBinary(encodeBinaryForJson(buf)), true);
});

Deno.test("encodeBinaryForJson - encodes nested Uint8Array inside objects", () => {
  const encoded = encodeBinaryForJson({
    name: "alice",
    avatar: new Uint8Array([1, 2, 3]),
  }) as { name: string; avatar: unknown };
  assertEquals(encoded.name, "alice");
  assertEquals(isEncodedBinary(encoded.avatar), true);
});

Deno.test("encodeBinaryForJson - encodes top-level undefined as marker", () => {
  const encoded = encodeBinaryForJson(undefined) as Record<string, unknown>;
  assertEquals(encoded.__b3nd_undefined__, true);
});

Deno.test("encodeBinaryForJson - encodes undefined inside arrays", () => {
  const encoded = encodeBinaryForJson([
    "a",
    undefined,
    "c",
  ]) as unknown[];
  assertEquals(encoded[0], "a");
  assertEquals(encoded[2], "c");
  assertEquals(
    (encoded[1] as Record<string, unknown>).__b3nd_undefined__,
    true,
  );
});

Deno.test("decodeBinaryFromJson - returns originals for unmarked values", () => {
  assertEquals(decodeBinaryFromJson("hello"), "hello");
  assertEquals(decodeBinaryFromJson(42), 42);
  assertEquals(decodeBinaryFromJson({ key: "val" }), { key: "val" });
});

Deno.test("round-trip - Uint8Array", () => {
  const original = new Uint8Array([0, 1, 127, 128, 255]);
  const decoded = decodeBinaryFromJson(encodeBinaryForJson(original));
  assertInstanceOf(decoded, Uint8Array);
  assertEquals(decoded, original);
});

Deno.test("round-trip - empty Uint8Array", () => {
  const decoded = decodeBinaryFromJson(encodeBinaryForJson(new Uint8Array([])));
  assertInstanceOf(decoded, Uint8Array);
  assertEquals((decoded as Uint8Array).length, 0);
});

Deno.test("round-trip - large payload (1KB)", () => {
  const original = crypto.getRandomValues(new Uint8Array(1024));
  const decoded = decodeBinaryFromJson(encodeBinaryForJson(original));
  assertInstanceOf(decoded, Uint8Array);
  assertEquals(decoded, original);
});

Deno.test("round-trip - serializable as JSON end-to-end", () => {
  const original = new Uint8Array([10, 20, 30]);
  const wire = JSON.parse(JSON.stringify(encodeBinaryForJson(original)));
  const decoded = decodeBinaryFromJson(wire);
  assertInstanceOf(decoded, Uint8Array);
  assertEquals(decoded, original);
});

Deno.test("round-trip - undefined stays distinct from null", () => {
  const original = { miss: undefined, deleted: null, present: 1 };
  const wire = JSON.parse(JSON.stringify(encodeBinaryForJson(original)));
  const decoded = decodeBinaryFromJson(wire) as Record<string, unknown>;
  assertEquals(decoded.miss, undefined);
  assertEquals(decoded.deleted, null);
  assertEquals(decoded.present, 1);
});

Deno.test("round-trip - undefined inside arrays survives JSON", () => {
  const original = ["a", undefined, "c"];
  const wire = JSON.parse(JSON.stringify(encodeBinaryForJson(original)));
  const decoded = decodeBinaryFromJson(wire) as unknown[];
  assertEquals(decoded, ["a", undefined, "c"]);
});

