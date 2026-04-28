/**
 * Binary Operations Test Suite
 *
 * Comprehensive tests for binary data upload/download functionality.
 * Tests binary Content-Type detection, MIME type handling, and data integrity.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { HttpClient } from "../b3nd-client-http/mod.ts";
import { MockHttpServer } from "../b3nd-testing/mock-http-server.ts";

// Test server configuration
const TEST_PORT = 8790;
let server: MockHttpServer;

// Setup: Start mock server before tests
async function setup(): Promise<void> {
  server = new MockHttpServer({
    port: TEST_PORT,
    mode: "happy",
  });
  await server.start();
}

// Teardown: Stop mock server after tests
async function teardown(): Promise<void> {
  if (server) {
    await server.stop();
  }
}

// Create client for tests
function createClient(): HttpClient {
  return new HttpClient({
    url: `http://127.0.0.1:${TEST_PORT}`,
  });
}

// Helper to create random binary data
function createRandomBinary(size: number): Uint8Array {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    data[i] = Math.floor(Math.random() * 256);
  }
  return data;
}

// Helper to compare two Uint8Arrays
function compareBinary(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ============================================================================
// Binary Upload/Download Tests
// ============================================================================

Deno.test({
  name: "Binary Operations - setup",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await setup();
  },
});

Deno.test({
  name: "Binary - write and read PNG image",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const client = createClient();

    // PNG file header signature
    const pngData = new Uint8Array([
      0x89,
      0x50,
      0x4E,
      0x47,
      0x0D,
      0x0A,
      0x1A,
      0x0A,
      0x00,
      0x00,
      0x00,
      0x0D,
      0x49,
      0x48,
      0x44,
      0x52,
      0x00,
      0x00,
      0x00,
      0x10,
      0x00,
      0x00,
      0x00,
      0x10,
      0x08,
      0x02,
      0x00,
      0x00,
      0x00,
      0x90,
      0x91,
      0x68,
    ]);

    const result = await client.receive([["files://images/test.png", pngData]]);
    assertEquals(result[0].accepted, true, "PNG write should succeed");

    const readResults = await client.read<Uint8Array>(
      "files://images/test.png",
    );
    assertEquals(readResults[0].success, true, "PNG read should succeed");
    assertEquals(
      readResults[0].record?.data instanceof Uint8Array,
      true,
      "Should return Uint8Array",
    );

    const readData = readResults[0].record?.data as Uint8Array;
    assertEquals(
      compareBinary(pngData, readData),
      true,
      "PNG data should match",
    );
  },
});

Deno.test({
  name: "Binary - write and read JPEG image",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const client = createClient();

    // JPEG file header signature (SOI + APP0)
    const jpegData = new Uint8Array([
      0xFF,
      0xD8,
      0xFF,
      0xE0,
      0x00,
      0x10,
      0x4A,
      0x46,
      0x49,
      0x46,
      0x00,
      0x01,
      0x01,
      0x00,
      0x00,
      0x01,
    ]);

    const result = await client.receive([[
      "files://images/photo.jpg",
      jpegData,
    ]]);
    assertEquals(result[0].accepted, true, "JPEG write should succeed");

    const readResults = await client.read<Uint8Array>(
      "files://images/photo.jpg",
    );
    assertEquals(readResults[0].success, true, "JPEG read should succeed");

    const readData = readResults[0].record?.data as Uint8Array;
    assertEquals(
      compareBinary(jpegData, readData),
      true,
      "JPEG data should match",
    );
  },
});

Deno.test({
  name: "Binary - write and read WebAssembly module",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const client = createClient();

    // WASM magic number and version
    const wasmData = new Uint8Array([
      0x00,
      0x61,
      0x73,
      0x6D, // Magic: \0asm
      0x01,
      0x00,
      0x00,
      0x00, // Version: 1
      0x01,
      0x07,
      0x01,
      0x60, // Type section
    ]);

    const result = await client.receive([[
      "files://modules/app.wasm",
      wasmData,
    ]]);
    assertEquals(result[0].accepted, true, "WASM write should succeed");

    const readResults = await client.read<Uint8Array>(
      "files://modules/app.wasm",
    );
    assertEquals(readResults[0].success, true, "WASM read should succeed");

    const readData = readResults[0].record?.data as Uint8Array;
    assertEquals(
      compareBinary(wasmData, readData),
      true,
      "WASM data should match",
    );
  },
});

Deno.test({
  name: "Binary - write and read font file",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const client = createClient();

    // WOFF2 header
    const fontData = new Uint8Array([
      0x77,
      0x4F,
      0x46,
      0x32, // wOF2 signature
      0x00,
      0x01,
      0x00,
      0x00, // Flavor
      0x00,
      0x00,
      0x10,
      0x00, // Length
    ]);

    const result = await client.receive([[
      "files://fonts/app.woff2",
      fontData,
    ]]);
    assertEquals(result[0].accepted, true, "Font write should succeed");

    const readResults = await client.read<Uint8Array>(
      "files://fonts/app.woff2",
    );
    assertEquals(readResults[0].success, true, "Font read should succeed");

    const readData = readResults[0].record?.data as Uint8Array;
    assertEquals(
      compareBinary(fontData, readData),
      true,
      "Font data should match",
    );
  },
});

Deno.test({
  name: "Binary - write and read large file (10KB)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const client = createClient();

    const largeData = createRandomBinary(10 * 1024); // 10KB

    const result = await client.receive([
      ["files://large/bigfile.bin", largeData],
    ]);
    assertEquals(result[0].accepted, true, "Large file write should succeed");

    const readResults = await client.read<Uint8Array>(
      "files://large/bigfile.bin",
    );
    assertEquals(
      readResults[0].success,
      true,
      "Large file read should succeed",
    );

    const readData = readResults[0].record?.data as Uint8Array;
    assertEquals(
      readData.length,
      largeData.length,
      "Large file size should match",
    );
    assertEquals(
      compareBinary(largeData, readData),
      true,
      "Large file data should match",
    );
  },
});

Deno.test({
  name: "Binary - write and read very large file (100KB)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const client = createClient();

    const veryLargeData = createRandomBinary(100 * 1024); // 100KB

    const result = await client.receive([
      ["files://large/verybig.bin", veryLargeData],
    ]);
    assertEquals(
      result[0].accepted,
      true,
      "Very large file write should succeed",
    );

    const readResults = await client.read<Uint8Array>(
      "files://large/verybig.bin",
    );
    assertEquals(
      readResults[0].success,
      true,
      "Very large file read should succeed",
    );

    const readData = readResults[0].record?.data as Uint8Array;
    assertEquals(
      readData.length,
      veryLargeData.length,
      "Very large file size should match",
    );
    assertEquals(
      compareBinary(veryLargeData, readData),
      true,
      "Very large file data should match",
    );
  },
});

Deno.test({
  name: "Binary - write empty binary data",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const client = createClient();

    const emptyData = new Uint8Array(0);

    const result = await client.receive([[
      "files://empty/zero.bin",
      emptyData,
    ]]);
    assertEquals(result[0].accepted, true, "Empty binary write should succeed");

    const readResults = await client.read<Uint8Array>("files://empty/zero.bin");
    assertEquals(
      readResults[0].success,
      true,
      "Empty binary read should succeed",
    );

    const readData = readResults[0].record?.data as Uint8Array;
    assertEquals(readData.length, 0, "Empty binary should have zero length");
  },
});

Deno.test({
  name: "Binary - overwrite existing binary file",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const client = createClient();

    const originalData = new Uint8Array([0x01, 0x02, 0x03]);
    const newData = new Uint8Array([0x04, 0x05, 0x06, 0x07, 0x08]);

    // Write original
    await client.receive([["files://overwrite/test.bin", originalData]]);

    // Overwrite with new data
    const result = await client.receive([
      ["files://overwrite/test.bin", newData],
    ]);
    assertEquals(result[0].accepted, true, "Overwrite should succeed");

    // Read back
    const readResults = await client.read<Uint8Array>(
      "files://overwrite/test.bin",
    );
    assertEquals(
      readResults[0].success,
      true,
      "Read after overwrite should succeed",
    );

    const readData = readResults[0].record?.data as Uint8Array;
    assertEquals(
      compareBinary(newData, readData),
      true,
      "Should return new data",
    );
    assertEquals(
      readData.length,
      newData.length,
      "Should have new data length",
    );
  },
});

Deno.test({
  name: "Binary - multiple files in same directory",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const client = createClient();

    const file1 = new Uint8Array([0x01, 0x01, 0x01]);
    const file2 = new Uint8Array([0x02, 0x02, 0x02]);
    const file3 = new Uint8Array([0x03, 0x03, 0x03]);

    await client.receive([["files://multi/a.bin", file1]]);
    await client.receive([["files://multi/b.bin", file2]]);
    await client.receive([["files://multi/c.bin", file3]]);

    const results = await client.read<Uint8Array>([
      "files://multi/a.bin",
      "files://multi/b.bin",
      "files://multi/c.bin",
    ]);

    assertEquals(results[0].success, true);
    assertEquals(results[1].success, true);
    assertEquals(results[2].success, true);

    assertEquals(
      compareBinary(file1, results[0].record?.data as Uint8Array),
      true,
    );
    assertEquals(
      compareBinary(file2, results[1].record?.data as Uint8Array),
      true,
    );
    assertEquals(
      compareBinary(file3, results[2].record?.data as Uint8Array),
      true,
    );
  },
});

Deno.test({
  name: "Binary - mixed JSON and binary operations",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const client = createClient();

    // Write JSON data
    const jsonData = { name: "test", value: 42 };
    const jsonResult = await client.receive([
      ["store://mixed/data.json", jsonData],
    ]);
    assertEquals(jsonResult[0].accepted, true, "JSON write should succeed");

    // Write binary data
    const binaryData = new Uint8Array([0xCA, 0xFE, 0xBA, 0xBE]);
    const binaryResult = await client.receive([
      ["store://mixed/data.bin", binaryData],
    ]);
    assertEquals(binaryResult[0].accepted, true, "Binary write should succeed");

    // Read JSON back
    const jsonRead = await client.read<typeof jsonData>(
      "store://mixed/data.json",
    );
    assertEquals(jsonRead[0].success, true, "JSON read should succeed");
    assertEquals(jsonRead[0].record?.data, jsonData, "JSON data should match");

    // Read binary back
    const binaryRead = await client.read<Uint8Array>("store://mixed/data.bin");
    assertEquals(binaryRead[0].success, true, "Binary read should succeed");
    assertEquals(
      compareBinary(binaryData, binaryRead[0].record?.data as Uint8Array),
      true,
      "Binary data should match",
    );
  },
});

Deno.test({
  name: "Binary Operations - teardown",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await teardown();
  },
});
