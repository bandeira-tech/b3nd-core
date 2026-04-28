/**
 * Binary data encoding utilities for JSON-based storage backends
 *
 * Since JSON.stringify(Uint8Array) produces {0: x, 1: y, ...} instead of
 * proper binary representation, we need to encode binary data to base64
 * with a type marker for round-trip serialization.
 */

const BINARY_MARKER = "__b3nd_binary__";

interface EncodedBinary {
  [BINARY_MARKER]: true;
  data: string; // base64 encoded
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
 * Encode binary data for JSON storage.
 * Recursively walks objects and arrays to encode any Uint8Array or ArrayBuffer
 * found at any depth — necessary for envelope messages with nested binary outputs.
 * Returns the original value if not binary and not a container.
 */
export function encodeBinaryForJson(value: unknown): unknown {
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
 * Decode binary data from JSON storage
 * Returns the original value if not encoded binary
 */
export function decodeBinaryFromJson<T>(value: T): T | Uint8Array {
  if (isEncodedBinary(value)) {
    const binary = atob(value.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return value;
}
