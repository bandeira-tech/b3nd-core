/**
 * @module
 * Binary — content codec for carrying `Uint8Array` / `ArrayBuffer`
 * through JSON wire transports.
 *
 * **Not a framework feature.** The b3nd framework is content-opaque:
 * `Output<T> = [uri, payload]` says nothing about what `payload`
 * holds. This lib is one possible content codec a protocol/canon can
 * opt into when its payloads include binary fields that need to
 * survive JSON.
 *
 * Use pattern (caller's layer, not framework or transport):
 *
 * ```ts
 * import {
 *   decodeBinaryFromJson,
 *   encodeBinaryForJson,
 * } from "@bandeira-tech/b3nd-core/binary";
 *
 * await client.receive([
 *   [uri, encodeBinaryForJson({ avatar: bytes, name: "alice" })],
 * ]);
 *
 * const [r] = await client.read([uri]);
 * const profile = decodeBinaryFromJson(r[1]);
 * ```
 *
 * Wire shape:
 *   `Uint8Array` / `ArrayBuffer` → `{__b3nd_binary__: true, data: <base64>}`
 *
 * The lib never inspects or transforms anything else (no `undefined`
 * handling, no null reinterpretation). Other JSON wire concerns —
 * preserving `undefined`, etc. — live in their respective transports.
 */

import { decodeBase64, encodeBase64 } from "../b3nd-core/encoding.ts";

const BINARY_MARKER = "__b3nd_binary__";

/** Wire shape carrying a `Uint8Array` through JSON. */
export interface EncodedBinary {
  [BINARY_MARKER]: true;
  data: string; // base64
}

/** True iff `value` is a `Uint8Array` or `ArrayBuffer`. */
export function isBinary(value: unknown): value is Uint8Array | ArrayBuffer {
  return value instanceof Uint8Array || value instanceof ArrayBuffer;
}

/** True iff `value` is an encoded-binary marker object. */
export function isEncodedBinary(value: unknown): value is EncodedBinary {
  return (
    typeof value === "object" &&
    value !== null &&
    BINARY_MARKER in value &&
    (value as EncodedBinary)[BINARY_MARKER] === true
  );
}

/**
 * Walk a value and replace every `Uint8Array` / `ArrayBuffer` leaf
 * with a base64 binary marker. Non-binary leaves (including `null`
 * and `undefined`) pass through unchanged.
 */
export function encodeBinaryForJson(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { [BINARY_MARKER]: true, data: encodeBase64(value) };
  }
  if (value instanceof ArrayBuffer) {
    return {
      [BINARY_MARKER]: true,
      data: encodeBase64(new Uint8Array(value)),
    };
  }
  if (Array.isArray(value)) return value.map(encodeBinaryForJson);
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = encodeBinaryForJson(val);
    }
    return result;
  }
  return value;
}

/**
 * Walk a value and replace every binary-marker leaf with the original
 * `Uint8Array`. Non-marker leaves pass through unchanged.
 */
export function decodeBinaryFromJson<T>(value: T): T | Uint8Array {
  if (isEncodedBinary(value)) return decodeBase64(value.data);
  if (Array.isArray(value)) {
    return value.map(decodeBinaryFromJson) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = decodeBinaryFromJson(val);
    }
    return result as unknown as T;
  }
  return value;
}
