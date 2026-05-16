/**
 * FunctionalClient Test Suite
 *
 * Tests for the FunctionalClient class which delegates PIN methods
 * to config functions, with sensible defaults for missing methods.
 */

import { assertEquals } from "@std/assert";
import { FunctionalClient } from "./functional-client.ts";
import type { Output } from "../types/types.ts";
import { parseUrl } from "../url/url.ts";

// ============================================================================
// Default behavior (no config functions provided)
// ============================================================================

Deno.test("FunctionalClient - receive defaults to not-implemented", async () => {
  const client = new FunctionalClient({});
  const result = await client.receive([["mutable://test", { hello: "world" }]]);
  assertEquals(result[0].accepted, false);
  assertEquals(result[0].error, "not implemented");
});

Deno.test("FunctionalClient - read defaults to empty (absence)", async () => {
  // Option-A: with no config, read produces no Outputs.
  const client = new FunctionalClient({});
  const results = await client.read(["mutable://test"]);
  assertEquals(results.length, 0);
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
  const calls: Output[] = [];
  const client = new FunctionalClient({
    receive: (msgs) => {
      for (const msg of msgs) calls.push(msg);
      return Promise.resolve(msgs.map(() => ({ accepted: true })));
    },
  });

  const msg: Output = ["mutable://users/alice", { name: "Alice" }];
  const result = await client.receive([msg]);
  assertEquals(result[0].accepted, true);
  assertEquals(calls.length, 1);
  assertEquals(calls[0], msg);
});

Deno.test("FunctionalClient - custom read is called", async () => {
  const client = new FunctionalClient({
    read: <T = unknown>(urls: string[]): Promise<Output<T>[]> => {
      return Promise.resolve(
        urls.map((u) => [u, { name: "Alice" } as T] as Output<T>),
      );
    },
  });

  const results = await client.read(["mutable://users/alice"]);
  assertEquals(results.length, 1);
  assertEquals(results[0]?.[1], { name: "Alice" });
});

Deno.test("FunctionalClient - custom status is called", async () => {
  const client = new FunctionalClient({
    status: () =>
      Promise.resolve({
        status: "degraded" as const,
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
    read: <T = unknown>(urls: string[]): Promise<Output<T>[]> => {
      // Option-A: emit Outputs only for hits; misses are absent.
      const out: Output<T>[] = [];
      for (const uri of urls) {
        if (uri in store) out.push([uri, store[uri] as T]);
      }
      return Promise.resolve(out);
    },
  });

  const results = await client.read([
    "mutable://a",
    "mutable://b",
    "mutable://missing",
  ]);

  assertEquals(results.length, 2);
  assertEquals(results.map((r) => r[0]), ["mutable://a", "mutable://b"]);
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
  const store = new Map<string, unknown>();

  const client = new FunctionalClient({
    receive: (msgs) => {
      for (const [uri, payload] of msgs) {
        store.set(uri, payload);
      }
      return Promise.resolve(msgs.map(() => ({ accepted: true })));
    },
    read: <T = unknown>(urls: string[]): Promise<Output<T>[]> => {
      const out: Output<T>[] = [];
      for (const url of urls) {
        const { uri, fn } = parseUrl(url);
        if (fn === "ls") {
          for (const [k, v] of store.entries()) {
            if (k.startsWith(uri)) out.push([k, v as T]);
          }
        } else {
          if (store.has(uri)) out.push([uri, store.get(uri) as T]);
        }
      }
      return Promise.resolve(out);
    },
  });

  // Write
  const writeResult = await client.receive([
    ["mutable://users/alice", { name: "Alice" }],
  ]);
  assertEquals(writeResult[0].accepted, true);

  // Read
  const readResults = await client.read(["mutable://users/alice"]);
  assertEquals(readResults.length, 1);
  assertEquals(readResults[0]?.[1], { name: "Alice" });

  // List via trailing slash
  const listResults = await client.read(["mutable://users/"]);
  assertEquals(listResults.length, 1);
  assertEquals(listResults[0]?.[0], "mutable://users/alice");
});
