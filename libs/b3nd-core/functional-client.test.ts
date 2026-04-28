/**
 * FunctionalClient Test Suite
 *
 * Tests for the FunctionalClient class which delegates PIN methods
 * to config functions, with sensible defaults for missing methods.
 */

import { assertEquals } from "@std/assert";
import { FunctionalClient } from "./functional-client.ts";
import type { Message, ReadResult, ReceiveResult } from "./types.ts";

// ============================================================================
// Default behavior (no config functions provided)
// ============================================================================

Deno.test("FunctionalClient - receive defaults to not-implemented", async () => {
  const client = new FunctionalClient({});
  const result = await client.receive([["mutable://test", { hello: "world" }]]);
  assertEquals(result[0].accepted, false);
  assertEquals(result[0].error, "not implemented");
});

Deno.test("FunctionalClient - read defaults to not-implemented", async () => {
  const client = new FunctionalClient({});
  const results = await client.read("mutable://test");
  assertEquals(results.length, 1);
  assertEquals(results[0].success, false);
  assertEquals(results[0].error, "not implemented");
});

Deno.test("FunctionalClient - status defaults to healthy", async () => {
  const client = new FunctionalClient({});
  const result = await client.status();
  assertEquals(result.status, "healthy");
});

// ============================================================================
// Custom config functions
// ============================================================================

Deno.test("FunctionalClient - custom receive is called", async () => {
  const calls: Message[] = [];
  const client = new FunctionalClient({
    receive: async (msgs) => {
      for (const msg of msgs) calls.push(msg);
      return msgs.map(() => ({ accepted: true }));
    },
  });

  const msg: Message = ["mutable://users/alice", { name: "Alice" }];
  const result = await client.receive([msg]);
  assertEquals(result[0].accepted, true);
  assertEquals(calls.length, 1);
  assertEquals(calls[0], msg);
});

Deno.test("FunctionalClient - custom read is called", async () => {
  const client = new FunctionalClient({
    read: async <T = unknown>(
      uris: string | string[],
    ): Promise<ReadResult<T>[]> => {
      const uriList = Array.isArray(uris) ? uris : [uris];
      return uriList.map(() => ({
        success: true,
        record: { data: { name: "Alice" } as T },
      }));
    },
  });

  const results = await client.read("mutable://users/alice");
  assertEquals(results.length, 1);
  assertEquals(results[0].success, true);
  assertEquals(results[0].record?.data, { name: "Alice" });
});

Deno.test("FunctionalClient - custom status is called", async () => {
  const client = new FunctionalClient({
    status: async () => ({
      status: "degraded",
      message: "high latency",
    }),
  });

  const result = await client.status();
  assertEquals(result.status, "degraded");
  assertEquals(result.message, "high latency");
});

// ============================================================================
// Multi-read via read([uri1, uri2])
// ============================================================================

Deno.test("FunctionalClient - read with multiple URIs", async () => {
  const store: Record<string, unknown> = {
    "mutable://a": "alpha",
    "mutable://b": "beta",
  };

  const client = new FunctionalClient({
    read: async <T = unknown>(
      uris: string | string[],
    ): Promise<ReadResult<T>[]> => {
      const uriList = Array.isArray(uris) ? uris : [uris];
      return uriList.map((uri) => {
        if (uri in store) {
          return { success: true, record: { data: store[uri] as T } };
        }
        return { success: false, error: "not found" };
      });
    },
  });

  const results = await client.read([
    "mutable://a",
    "mutable://b",
    "mutable://missing",
  ]);

  assertEquals(results.length, 3);
  assertEquals(results[0].success, true);
  assertEquals(results[1].success, true);
  assertEquals(results[2].success, false);
});

Deno.test("FunctionalClient - read with empty array", async () => {
  const client = new FunctionalClient({});
  const results = await client.read([]);
  assertEquals(results.length, 0);
});

// ============================================================================
// Integration: in-memory store via FunctionalClient
// ============================================================================

Deno.test("FunctionalClient - works as in-memory store", async () => {
  const store = new Map<string, { data: unknown }>();

  const client = new FunctionalClient({
    receive: async (msgs) => {
      for (const [uri, payload] of msgs) {
        store.set(uri, { data: payload });
      }
      return msgs.map(() => ({ accepted: true }));
    },
    read: async <T = unknown>(
      uris: string | string[],
    ): Promise<ReadResult<T>[]> => {
      const uriList = Array.isArray(uris) ? uris : [uris];
      return uriList.map((uri) => {
        if (uri.endsWith("/")) {
          // List mode: return items matching prefix
          const items = [...store.entries()]
            .filter(([k]) => k.startsWith(uri.slice(0, -1)))
            .map(([k, v]) => ({
              success: true as const,
              uri: k,
              record: v as { data: T },
            }));
          return items.length > 0
            ? items[0]
            : { success: false, error: "not found" };
        }
        const record = store.get(uri);
        if (!record) return { success: false, error: "not found" };
        return { success: true, record: record as { data: T } };
      });
    },
  });

  // Write
  const writeResult = await client.receive([
    ["mutable://users/alice", { name: "Alice" }],
  ]);
  assertEquals(writeResult[0].accepted, true);

  // Read
  const readResults = await client.read("mutable://users/alice");
  assertEquals(readResults[0].success, true);
  assertEquals(readResults[0].record?.data, { name: "Alice" });

  // List via trailing slash
  const listResults = await client.read("mutable://users/");
  assertEquals(listResults[0].success, true);
  assertEquals(listResults[0].uri, "mutable://users/alice");
});
