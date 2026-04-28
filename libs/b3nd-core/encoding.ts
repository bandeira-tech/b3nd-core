export function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

export function encodeBase64(bytes: Uint8Array): string {
  const buf =
    (typeof globalThis !== "undefined" && (globalThis as any).Buffer) ||
    undefined;
  if (buf) {
    return buf.from(bytes).toString("base64");
  }
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

export function decodeBase64(b64: string): Uint8Array {
  const buf =
    (typeof globalThis !== "undefined" && (globalThis as any).Buffer) ||
    undefined;
  if (buf) {
    return new Uint8Array(buf.from(b64, "base64"));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
