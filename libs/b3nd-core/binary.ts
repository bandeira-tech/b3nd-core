/**
 * Binary data encoding utilities for JSON-based storage backends
 *
 * Since JSON.stringify(Uint8Array) produces {0: x, 1: y, ...} instead of
 * proper binary representation, we need to encode binary data to base64
 * with a type marker for round-trip serialization.
 */

const BINARY_MARKER = "__b3nd_binary__";
const UNDEFINED_MARKER = "__b3nd_undefined__";

interface EncodedBinary {
  [BINARY_MARKER]: true;
  data: string; // base64 encoded
}

interface EncodedUndefined {
  [UNDEFINED_MARKER]: true;
}

function isEncodedUndefined(value: unknown): value is EncodedUndefined {
  return (
    typeof value === "object" &&
    value !== null &&
    UNDEFINED_MARKER in value &&
    (value as EncodedUndefined)[UNDEFINED_MARKER] === true
  );
}

/**
 * Check if a value is a Uint8Array or ArrayBuffer
 */
export function isBinary(value: unknown): value is Uint8Array | ArrayBuffer {
  return value instanceof Uint8Array || value instanceof ArrayBuffer;
}

/**
 * Check if a value is an encoded binary object
 */
export function isEncodedBinary(value: unknown): value is EncodedBinary {
  return (
    typeof value === "object" &&
    value !== null &&
    BINARY_MARKER in value &&
    (value as EncodedBinary)[BINARY_MARKER] === true
  );
}

/**
 * Encode JSON-hostile values for wire transport.
 * Recursively walks arrays and objects to:
 *   - encode `Uint8Array`/`ArrayBuffer` as base64 markers
 *   - encode `undefined` as a `__b3nd_undefined__` marker (so it
 *     survives JSON, where it would otherwise collapse to `null` in
 *     arrays or be dropped from objects). This matters for read
 *     results where an `undefined` payload means "not found" and must
 *     stay distinct from a stored `null`.
 */
export function encodeBinaryForJson(value: unknown): unknown {
  if (value === undefined) return { [UNDEFINED_MARKER]: true };
  if (value instanceof Uint8Array) {
    return {
      [BINARY_MARKER]: true,
      data: btoa(String.fromCharCode(...value)),
    };
  }
  if (value instanceof ArrayBuffer) {
    return {
      [BINARY_MARKER]: true,
      data: btoa(String.fromCharCode(...new Uint8Array(value))),
    };
  }
  if (Array.isArray(value)) {
    return value.map(encodeBinaryForJson);
  }
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
 * Decode wire values back to their original form. Mirrors
 * `encodeBinaryForJson` — recurses through arrays and objects to:
 *   - decode base64 markers back to `Uint8Array`
 *   - decode `__b3nd_undefined__` markers back to `undefined`
 */
export function decodeBinaryFromJson<T>(value: T): T | Uint8Array | undefined {
  if (isEncodedUndefined(value)) return undefined;
  if (isEncodedBinary(value)) {
    const binary = atob(value.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
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
