/**
 * Tests for the binary content codec.
 */

import { assertEquals, assertInstanceOf } from "@std/assert";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
  isBinary,
  isEncodedBinary,
} from "./mod.ts";

// ── isBinary / isEncodedBinary ──────────────────────────────────────

Deno.test("isBinary - Uint8Array is binary", () => {
  assertEquals(isBinary(new Uint8Array([1, 2, 3])), true);
});

Deno.test("isBinary - ArrayBuffer is binary", () => {
  assertEquals(isBinary(new ArrayBuffer(8)), true);
});

Deno.test("isBinary - plain object / null / string are not binary", () => {
  assertEquals(isBinary({ data: [1, 2, 3] }), false);
  assertEquals(isBinary(null), false);
  assertEquals(isBinary("string"), false);
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

Deno.test("encodeBinaryForJson - returns originals for non-binary values", () => {
  assertEquals(encodeBinaryForJson("hello"), "hello");
  assertEquals(encodeBinaryForJson(42), 42);
  assertEquals(encodeBinaryForJson({ key: "val" }), { key: "val" });
  assertEquals(encodeBinaryForJson(null), null);
  // undefined is NOT this codec's concern — passes through unchanged.
  assertEquals(encodeBinaryForJson(undefined), undefined);
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

Deno.test("round-trip - nested binary inside objects and arrays", () => {
  const original = {
    items: [
      { name: "a", bytes: new Uint8Array([1, 2, 3]) },
      { name: "b", bytes: new Uint8Array([4, 5, 6]) },
    ],
  };
  const wire = JSON.parse(JSON.stringify(encodeBinaryForJson(original)));
  const decoded = decodeBinaryFromJson(wire) as typeof original;
  assertInstanceOf(decoded.items[0].bytes, Uint8Array);
  assertEquals(decoded.items[0].bytes, original.items[0].bytes);
  assertEquals(decoded.items[1].bytes, original.items[1].bytes);
});
