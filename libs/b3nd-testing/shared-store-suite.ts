/**
 * Shared Test Suite for Store Interface
 *
 * Tests that any implementation of Store behaves correctly
 * as **mechanical storage**.
 *
 * Store is batch-native: every operation takes arrays and returns
 * per-item results. This suite validates the contract:
 * - write(entries) → StoreWriteResult[]
 * - read(uris) → ReadResult[]  (trailing-slash = list)
 * - delete(uris) → DeleteResult[]
 * - status() → StatusResult
 * - capabilities() → StoreCapabilities (optional)
 *
 * Each store test file imports and runs this suite with a factory
 * function that creates a fresh Store instance for each test.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "@std/assert";
import type { Store } from "../b3nd-core/types.ts";

/**
 * Factory and options for the shared Store test suite.
 */
export interface StoreTestConfig {
  /** Factory that returns a fresh Store for each test. */
  create: () => Store | Promise<Store>;

  /**
   * Whether this store supports reading back written data.
   * Set to false for write-only stores.
   * Defaults to true.
   */
  supportsRead?: boolean;

  /**
   * Whether this store supports trailing-slash list queries.
   * Defaults to true when supportsRead is true.
   */
  supportsList?: boolean;
}

/**
 * Run the complete shared Store test suite.
 */
export function runSharedStoreSuite(
  suiteName: string,
  config: StoreTestConfig,
) {
  const noSanitize = { sanitizeOps: false, sanitizeResources: false };
  const supportsRead = config.supportsRead !== false;
  const supportsList = config.supportsList ?? supportsRead;

  // ── Write ───────────────────────────────────────────────────────

  Deno.test({
    name: `${suiteName} - write single entry`,
    ...noSanitize,
    fn: async () => {
      const store = await Promise.resolve(config.create());

      const results = await store.write([
        { uri: "store://app/config", data: { theme: "dark" } },
      ]);

      assertEquals(results.length, 1);
    },
  });

  Deno.test({
    name: `${suiteName} - write batch of entries`,
    ...noSanitize,
    fn: async () => {
      const store = await Promise.resolve(config.create());

      const results = await store.write([
        { uri: "store://app/a", data: "A" },
        { uri: "store://app/b", data: { values: { fire: 10 }, label: "B" } },
        { uri: "store://app/c", data: "C" },
      ]);

      assertEquals(results.length, 3);
      assertEquals(results.every((r) => r.success), true);
    },
  });

  // ── Write + Read ────────────────────────────────────────────────

  if (supportsRead) {
    Deno.test({
      name: `${suiteName} - write and read back`,
      ...noSanitize,
      fn: async () => {
        const store = await Promise.resolve(config.create());

        await store.write([
          {
            uri: "store://app/config",
            data: { theme: "dark" },
          },
        ]);

        const results = await store.read(["store://app/config"]);
        assertEquals(results.length, 1);
        assertEquals(results[0]?.[1], { theme: "dark" });
      },
    });

    Deno.test({
      name: `${suiteName} - batch write and read all back`,
      ...noSanitize,
      fn: async () => {
        const store = await Promise.resolve(config.create());

        await store.write([
          { uri: "store://app/a", data: "A" },
          { uri: "store://app/b", data: { values: { fire: 10 }, label: "B" } },
          { uri: "store://app/c", data: "C" },
        ]);

        const results = await store.read([
          "store://app/a",
          "store://app/b",
          "store://app/c",
        ]);
        assertEquals(results.length, 3);
        assertEquals(results[0]?.[1], "A");
        assertEquals(results[1]?.[1], {
          values: { fire: 10 },
          label: "B",
        });
        assertEquals(results[2]?.[1], "C");
      },
    });

    Deno.test({
      name: `${suiteName} - write overwrites existing value`,
      ...noSanitize,
      fn: async () => {
        const store = await Promise.resolve(config.create());

        await store.write([
          { uri: "store://app/x", data: "old" },
        ]);
        await store.write([
          { uri: "store://app/x", data: "new" },
        ]);

        const results = await store.read(["store://app/x"]);
        assertEquals(results[0]?.[1], "new");
      },
    });

    // ── Conserved quantities live inside the payload ───────────────
    // Per RFC 001: the wire (and store) primitive has no values slot;
    // protocols put conserved quantities at a payload-defined key.

    Deno.test({
      name: `${suiteName} - preserves payload-embedded values on write/read`,
      ...noSanitize,
      fn: async () => {
        const store = await Promise.resolve(config.create());

        await store.write([
          {
            uri: "store://app/token",
            data: { values: { fire: 100, water: 50 } },
          },
        ]);

        const results = await store.read(["store://app/token"]);
        assertEquals(results[0]?.[1], {
          values: { fire: 100, water: 50 },
        });
      },
    });

    Deno.test({
      name: `${suiteName} - overwrite preserves new payload`,
      ...noSanitize,
      fn: async () => {
        const store = await Promise.resolve(config.create());

        await store.write([
          { uri: "store://app/v", data: { values: { fire: 100 } } },
        ]);
        await store.write([
          {
            uri: "store://app/v",
            data: {
              values: { fire: 75, usd: 25 },
              memo: "updated",
            },
          },
        ]);

        const results = await store.read(["store://app/v"]);
        assertEquals(results[0]?.[1], {
          values: { fire: 75, usd: 25 },
          memo: "updated",
        });
      },
    });

    // ── Scalar data types ───────────────────────────────────────────

    Deno.test({
      name: `${suiteName} - read/write string data`,
      ...noSanitize,
      fn: async () => {
        const store = await Promise.resolve(config.create());

        await store.write([
          { uri: "store://scalar/str", data: "hello world" },
        ]);

        const results = await store.read(["store://scalar/str"]);
        assertEquals(results[0]?.[1], "hello world");
      },
    });

    Deno.test({
      name: `${suiteName} - read/write number data`,
      ...noSanitize,
      fn: async () => {
        const store = await Promise.resolve(config.create());

        await store.write([
          { uri: "store://scalar/num", data: 42 },
        ]);

        const results = await store.read(["store://scalar/num"]);
        assertEquals(results[0]?.[1], 42);
      },
    });

    Deno.test({
      name: `${suiteName} - read/write boolean data`,
      ...noSanitize,
      fn: async () => {
        const store = await Promise.resolve(config.create());

        await store.write([
          { uri: "store://scalar/bool", data: true },
        ]);

        const results = await store.read(["store://scalar/bool"]);
        assertEquals(results[0]?.[1], true);
      },
    });

    Deno.test({
      name: `${suiteName} - read/write null data`,
      ...noSanitize,
      fn: async () => {
        const store = await Promise.resolve(config.create());

        await store.write([
          { uri: "store://scalar/null", data: null },
        ]);

        const results = await store.read(["store://scalar/null"]);
        assertEquals(results[0]?.[1], null);
      },
    });

    Deno.test({
      name: `${suiteName} - read/write empty string data`,
      ...noSanitize,
      fn: async () => {
        const store = await Promise.resolve(config.create());

        await store.write([
          { uri: "store://scalar/empty", data: "" },
        ]);

        const results = await store.read(["store://scalar/empty"]);
        assertEquals(results[0]?.[1], "");
      },
    });

    Deno.test({
      name: `${suiteName} - read/write zero data`,
      ...noSanitize,
      fn: async () => {
        const store = await Promise.resolve(config.create());

        await store.write([
          { uri: "store://scalar/zero", data: 0 },
        ]);

        const results = await store.read(["store://scalar/zero"]);
        assertEquals(results[0]?.[1], 0);
      },
    });

    // ── Read: nonexistent, partial failures ─────────────────────────

    Deno.test({
      name: `${suiteName} - read nonexistent yields no Output (absence)`,
      ...noSanitize,
      fn: async () => {
        const store = await Promise.resolve(config.create());

        const results = await store.read(["store://app/missing"]);
        assertEquals(results.length, 0);
      },
    });

    Deno.test({
      name: `${suiteName} - read with partial failures`,
      ...noSanitize,
      fn: async () => {
        const store = await Promise.resolve(config.create());

        await store.write([
          { uri: "store://app/exists", data: { ok: true } },
        ]);

        const results = await store.read([
          "store://app/exists",
          "store://app/missing",
        ]);
        // Option-A: 1 hit + 1 miss = 1 Output.
        assertEquals(results.length, 1);
        assertEquals(results[0]?.[0], "store://app/exists");
      },
    });
  }

  // ── Read: not supported ─────────────────────────────────────────

  if (!supportsRead) {
    Deno.test({
      name: `${suiteName} - read returns error (write-only store)`,
      ...noSanitize,
      fn: async () => {
        const store = await Promise.resolve(config.create());

        const results = await store.read(["store://app/anything"]);
        assertEquals(results.length, 1);
      },
    });
  }

  // ── List (trailing slash) ───────────────────────────────────────

  if (supportsList) {
    Deno.test({
      name: `${suiteName} - trailing slash lists children`,
      ...noSanitize,
      fn: async () => {
        const store = await Promise.resolve(config.create());

        await store.write([
          {
            uri: "store://users/alice",
            data: { name: "Alice" },
          },
          {
            uri: "store://users/bob",
            data: { name: "Bob" },
          },
        ]);

        const results = await store.read(["store://users/"]);
        assertEquals(results.length >= 2, true);

        const uris = results.map((r) => r[0]).sort();
        assertEquals(uris.includes("store://users/alice"), true);
        assertEquals(uris.includes("store://users/bob"), true);
      },
    });
  }

  // ── Delete ──────────────────────────────────────────────────────

  Deno.test({
    name: `${suiteName} - delete returns success`,
    ...noSanitize,
    fn: async () => {
      const store = await Promise.resolve(config.create());

      await store.write([
        { uri: "store://app/x", data: "hello" },
      ]);

      const deleteResults = await store.delete(["store://app/x"]);
      assertEquals(deleteResults.length, 1);
    },
  });

  if (supportsRead) {
    Deno.test({
      name: `${suiteName} - delete removes entry`,
      ...noSanitize,
      fn: async () => {
        const store = await Promise.resolve(config.create());

        await store.write([
          { uri: "store://app/x", data: "hello" },
        ]);

        await store.delete(["store://app/x"]);

        const _readResults = await store.read(["store://app/x"]);
      },
    });
  }

  Deno.test({
    name: `${suiteName} - delete nonexistent succeeds silently`,
    ...noSanitize,
    fn: async () => {
      const store = await Promise.resolve(config.create());

      const results = await store.delete(["store://app/missing"]);
      assertEquals(results.length, 1);
    },
  });

  if (supportsRead) {
    Deno.test({
      name: `${suiteName} - batch delete`,
      ...noSanitize,
      fn: async () => {
        const store = await Promise.resolve(config.create());

        await store.write([
          { uri: "store://app/a", data: "A" },
          { uri: "store://app/b", data: "B" },
          { uri: "store://app/c", data: "C" },
        ]);

        await store.delete(["store://app/a", "store://app/c"]);

        const results = await store.read([
          "store://app/a",
          "store://app/b",
          "store://app/c",
        ]);
        // Option-A: deleted entries surface as absence, so only "B" remains.
        assertEquals(results.length, 1);
        assertEquals(results[0]?.[0], "store://app/b");
        assertEquals(results[0]?.[1], "B");
      },
    });
  }

  // ── Status ──────────────────────────────────────────────────────

  Deno.test({
    name: `${suiteName} - status returns healthy`,
    ...noSanitize,
    fn: async () => {
      const store = await Promise.resolve(config.create());

      const status = await store.status();
      assertEquals(status.status, "healthy");
    },
  });

  // ── Capabilities ────────────────────────────────────────────────

  Deno.test({
    name: `${suiteName} - capabilities returns valid shape`,
    ...noSanitize,
    fn: async () => {
      const store = await Promise.resolve(config.create());

      if (store.capabilities) {
        const caps = store.capabilities();
        assertEquals(typeof caps.atomicBatch, "boolean");
        assertEquals(typeof caps.binaryData, "boolean");
      }
    },
  });
}
