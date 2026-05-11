/**
 * @module
 * Binary — the single home for byte-level encoding in b3nd.
 *
 * **Everything that touches binary or wire-encodes JSON-hostile values
 * should go through this module.** Transports (HTTP, WS) and stores
 * must not roll their own marker shapes — they import from here.
 *
 * Three layers, kept separate:
 *
 * 1. **Primitives** — pure `bytes ↔ string` conversions.
 *    `encodeBase64` / `decodeBase64`, `encodeHex` / `decodeHex`.
 *    No JSON, no markers, no recursion.
 *
 * 2. **JSON-hostile-value markers** — the on-the-wire envelope shapes
 *    used to round-trip values JSON can't carry natively:
 *      - `Uint8Array` / `ArrayBuffer` → `{__b3nd_binary__: true, data: <base64>}`
 *      - `undefined`                  → `{__b3nd_undefined__: true}`
 *    Plus the predicates: `isBinary`, `isEncodedBinary`.
 *
 * 3. **Recursive wire encode/decode** — `encodeForJson` walks any
 *    value, swapping JSON-hostile leaves for their marker forms;
 *    `decodeFromJson` is the inverse.
 *
 * The lib is semantics-free: it never interprets *why* an `undefined`
 * is there or what a stored `null` means. That's the caller's
 * concern. The lib just preserves shapes faithfully.
 */

// ── 1. Primitives ─────────────────────────────────────────────────────

/** Encode bytes to lowercase hex. */
export function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Decode hex (any case) to bytes. Throws on odd-length input. */
export function decodeHex(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex input");
  }
  const buffer = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/** Encode bytes to base64 (Node Buffer-backed when available, btoa otherwise). */
export function encodeBase64(bytes: Uint8Array): string {
  const buf = nodeBuffer();
  if (buf) return buf.from(bytes).toString("base64");
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

/** Decode base64 to bytes. */
export function decodeBase64(b64: string): Uint8Array {
  const buf = nodeBuffer();
  if (buf) return new Uint8Array(buf.from(b64, "base64"));
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

interface NodeBuffer {
  from: (
    input: Uint8Array | string,
    encoding?: string,
  ) => { toString: (encoding: string) => string } & Uint8Array;
}

function nodeBuffer(): NodeBuffer | undefined {
  return (typeof globalThis !== "undefined" &&
    (globalThis as { Buffer?: NodeBuffer }).Buffer) || undefined;
}

// ── 2. Markers ────────────────────────────────────────────────────────

const BINARY_MARKER = "__b3nd_binary__";
const UNDEFINED_MARKER = "__b3nd_undefined__";

/**
 * Wire shape carrying a `Uint8Array` through JSON. Only the marker key
 * is checked on decode — extra fields (e.g. legacy `encoding: "base64"`
 * from older senders) are tolerated.
 */
export interface EncodedBinary {
  [BINARY_MARKER]: true;
  data: string; // base64
}

interface EncodedUndefined {
  [UNDEFINED_MARKER]: true;
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

function isEncodedUndefined(value: unknown): value is EncodedUndefined {
  return (
    typeof value === "object" &&
    value !== null &&
    UNDEFINED_MARKER in value &&
    (value as EncodedUndefined)[UNDEFINED_MARKER] === true
  );
}

// ── 3. Recursive wire encode / decode ─────────────────────────────────

/**
 * Encode a value for JSON wire transport. Recursively walks arrays
 * and objects to:
 *   - encode `Uint8Array` / `ArrayBuffer` as base64 binary markers
 *   - encode `undefined` as an undefined marker so it survives JSON
 *     (where it would otherwise collapse to `null` in arrays or get
 *     dropped from objects)
 *
 * Any other value is returned as-is; non-binary scalars and `null`
 * pass through unchanged.
 */
export function encodeBinaryForJson(value: unknown): unknown {
  if (value === undefined) return { [UNDEFINED_MARKER]: true };
  if (value instanceof Uint8Array) {
    return {
      [BINARY_MARKER]: true,
      data: encodeBase64(value),
    };
  }
  if (value instanceof ArrayBuffer) {
    return {
      [BINARY_MARKER]: true,
      data: encodeBase64(new Uint8Array(value)),
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
 * Inverse of `encodeBinaryForJson`. Recursively walks arrays and
 * objects to:
 *   - decode binary markers back to `Uint8Array`
 *   - decode undefined markers back to `undefined`
 *
 * Tolerant of senders that emit extra fields on the binary marker
 * (e.g. legacy `encoding: "base64"`) — the marker key alone is
 * authoritative.
 */
export function decodeBinaryFromJson<T>(value: T): T | Uint8Array | undefined {
  if (isEncodedUndefined(value)) return undefined;
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
