/**
 * Types & Errors Test Suite
 *
 * Tests for ErrorCode, Errors factory, ClientError, and binary utilities
 * from b3nd-core types and binary modules.
 */

import { assertEquals, assertInstanceOf } from "@std/assert";
import { ClientError, ErrorCode, Errors } from "./types.ts";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
  isBinary,
  isEncodedBinary,
} from "./binary.ts";

// ============================================================================
// ErrorCode enum
// ============================================================================

Deno.test("ErrorCode - all expected codes exist", () => {
  assertEquals(ErrorCode.UNAUTHORIZED, "UNAUTHORIZED");
  assertEquals(ErrorCode.FORBIDDEN, "FORBIDDEN");
  assertEquals(ErrorCode.INVALID_URI, "INVALID_URI");
  assertEquals(ErrorCode.INVALID_SCHEMA, "INVALID_SCHEMA");
  assertEquals(ErrorCode.INVALID_SEQUENCE, "INVALID_SEQUENCE");
  assertEquals(ErrorCode.NOT_FOUND, "NOT_FOUND");
  assertEquals(ErrorCode.CONFLICT, "CONFLICT");
  assertEquals(ErrorCode.STORAGE_ERROR, "STORAGE_ERROR");
  assertEquals(ErrorCode.INTERNAL_ERROR, "INTERNAL_ERROR");
});

// ============================================================================
// Errors factory
// ============================================================================

Deno.test("Errors.unauthorized - default message", () => {
  const err = Errors.unauthorized("mutable://test");
  assertEquals(err.code, ErrorCode.UNAUTHORIZED);
  assertEquals(err.message, "Unauthorized");
  assertEquals(err.uri, "mutable://test");
});

Deno.test("Errors.unauthorized - custom message", () => {
  const err = Errors.unauthorized("mutable://test", "Token expired");
  assertEquals(err.message, "Token expired");
});

Deno.test("Errors.forbidden - default message", () => {
  const err = Errors.forbidden("mutable://private");
  assertEquals(err.code, ErrorCode.FORBIDDEN);
  assertEquals(err.message, "Forbidden");
  assertEquals(err.uri, "mutable://private");
});

Deno.test("Errors.forbidden - custom message", () => {
  const err = Errors.forbidden("mutable://test", "Insufficient permissions");
  assertEquals(err.message, "Insufficient permissions");
});

Deno.test("Errors.invalidUri - default message", () => {
  const err = Errors.invalidUri("bad-uri");
  assertEquals(err.code, ErrorCode.INVALID_URI);
  assertEquals(err.message, "Invalid URI");
  assertEquals(err.uri, "bad-uri");
});

Deno.test("Errors.invalidSchema - includes details", () => {
  const details = { expected: "object", got: "string" };
  const err = Errors.invalidSchema("mutable://x", details);
  assertEquals(err.code, ErrorCode.INVALID_SCHEMA);
  assertEquals(err.message, "Schema validation failed");
  assertEquals(err.details, details);
});

Deno.test("Errors.invalidSequence - default message", () => {
  const err = Errors.invalidSequence("mutable://seq");
  assertEquals(err.code, ErrorCode.INVALID_SEQUENCE);
  assertEquals(err.message, "Invalid sequence number");
});

Deno.test("Errors.notFound - includes URI in message", () => {
  const err = Errors.notFound("mutable://missing");
  assertEquals(err.code, ErrorCode.NOT_FOUND);
  assertEquals(err.message, "Not found: mutable://missing");
  assertEquals(err.uri, "mutable://missing");
});

Deno.test("Errors.conflict - default message", () => {
  const err = Errors.conflict("mutable://dup");
  assertEquals(err.code, ErrorCode.CONFLICT);
  assertEquals(err.message, "Conflict");
});

Deno.test("Errors.storageError - with and without URI", () => {
  const errNoUri = Errors.storageError("disk full");
  assertEquals(errNoUri.code, ErrorCode.STORAGE_ERROR);
  assertEquals(errNoUri.message, "disk full");
  assertEquals(errNoUri.uri, undefined);

  const errWithUri = Errors.storageError("write failed", "mutable://x");
  assertEquals(errWithUri.uri, "mutable://x");
});

Deno.test("Errors.internal - with and without URI", () => {
  const err = Errors.internal("unexpected null", "mutable://broken");
  assertEquals(err.code, ErrorCode.INTERNAL_ERROR);
  assertEquals(err.message, "unexpected null");
  assertEquals(err.uri, "mutable://broken");
});

// ============================================================================
// ClientError
// ============================================================================

Deno.test("ClientError - is an Error instance", () => {
  const err = new ClientError("something broke", "INTERNAL_ERROR");
  assertInstanceOf(err, Error);
  assertInstanceOf(err, ClientError);
});

Deno.test("ClientError - preserves name, message, code", () => {
  const err = new ClientError("connection timeout", "TIMEOUT", {
    host: "localhost",
  });
  assertEquals(err.name, "ClientError");
  assertEquals(err.message, "connection timeout");
  assertEquals(err.code, "TIMEOUT");
  assertEquals(err.details, { host: "localhost" });
});

Deno.test("ClientError - details is optional", () => {
  const err = new ClientError("oops", "UNKNOWN");
  assertEquals(err.details, undefined);
});

Deno.test("ClientError - has a stack trace", () => {
  const err = new ClientError("test", "TEST");
  assertEquals(typeof err.stack, "string");
});

// ============================================================================
// Binary utilities (from binary.ts, exported via mod.ts)
// ============================================================================

Deno.test("isBinary - Uint8Array is binary", () => {
  assertEquals(isBinary(new Uint8Array([1, 2, 3])), true);
});

Deno.test("isBinary - ArrayBuffer is binary", () => {
  assertEquals(isBinary(new ArrayBuffer(8)), true);
});

Deno.test("isBinary - plain object is not binary", () => {
  assertEquals(isBinary({ data: "hello" }), false);
});

Deno.test("isBinary - string is not binary", () => {
  assertEquals(isBinary("hello"), false);
});

Deno.test("isBinary - null is not binary", () => {
  assertEquals(isBinary(null), false);
});

Deno.test("isEncodedBinary - recognizes encoded binary objects", () => {
  const encoded = encodeBinaryForJson(new Uint8Array([1, 2, 3]));
  assertEquals(isEncodedBinary(encoded), true);
});

Deno.test("isEncodedBinary - rejects plain objects", () => {
  assertEquals(isEncodedBinary({ data: "hello" }), false);
  assertEquals(isEncodedBinary(null), false);
  assertEquals(isEncodedBinary("string"), false);
});

Deno.test("encodeBinaryForJson - returns original for non-binary values", () => {
  assertEquals(encodeBinaryForJson("hello"), "hello");
  assertEquals(encodeBinaryForJson(42), 42);
  assertEquals(encodeBinaryForJson({ key: "val" }), { key: "val" });
  assertEquals(encodeBinaryForJson(null), null);
});

Deno.test("encodeBinaryForJson - encodes Uint8Array", () => {
  const encoded = encodeBinaryForJson(new Uint8Array([0xca, 0xfe]));
  assertEquals(isEncodedBinary(encoded), true);
  assertEquals(typeof (encoded as { data: string }).data, "string");
});

Deno.test("encodeBinaryForJson - encodes ArrayBuffer", () => {
  const buf = new Uint8Array([0xde, 0xad]).buffer;
  const encoded = encodeBinaryForJson(buf);
  assertEquals(isEncodedBinary(encoded), true);
});

Deno.test("decodeBinaryFromJson - returns original for non-encoded values", () => {
  assertEquals(decodeBinaryFromJson("hello"), "hello");
  assertEquals(decodeBinaryFromJson(42), 42);
  assertEquals(decodeBinaryFromJson({ key: "val" }), { key: "val" });
});

Deno.test("binary round-trip - Uint8Array encode/decode", () => {
  const original = new Uint8Array([0, 1, 127, 128, 255]);
  const encoded = encodeBinaryForJson(original);
  const decoded = decodeBinaryFromJson(encoded);
  assertInstanceOf(decoded, Uint8Array);
  assertEquals(decoded, original);
});

Deno.test("binary round-trip - empty Uint8Array", () => {
  const original = new Uint8Array([]);
  const encoded = encodeBinaryForJson(original);
  const decoded = decodeBinaryFromJson(encoded);
  assertInstanceOf(decoded, Uint8Array);
  assertEquals((decoded as Uint8Array).length, 0);
});

Deno.test("binary round-trip - large payload (1KB)", () => {
  const original = crypto.getRandomValues(new Uint8Array(1024));
  const encoded = encodeBinaryForJson(original);
  const decoded = decodeBinaryFromJson(encoded);
  assertInstanceOf(decoded, Uint8Array);
  assertEquals(decoded, original);
});

Deno.test("binary round-trip - serializable as JSON", () => {
  const original = new Uint8Array([10, 20, 30]);
  const encoded = encodeBinaryForJson(original);
  const json = JSON.stringify(encoded);
  const parsed = JSON.parse(json);
  const decoded = decodeBinaryFromJson(parsed);
  assertInstanceOf(decoded, Uint8Array);
  assertEquals(decoded, original);
});
