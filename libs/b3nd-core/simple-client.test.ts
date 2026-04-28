/**
 * SimpleClient Tests
 *
 * Tests the bare ProtocolInterfaceNode wrapper over a Store.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { SimpleClient } from "./simple-client.ts";
import { MemoryStore } from "../b3nd-client-memory/store.ts";

Deno.test({
  name: "SimpleClient - receive writes message at its URI",
  fn: async () => {
    const store = new MemoryStore();
    const client = new SimpleClient(store);

    const results = await client.receive([
      ["mutable://app/config", { theme: "dark" }],
    ]);
    assertEquals(results.length, 1);
    assertEquals(results[0].accepted, true);

    const read = await client.read("mutable://app/config");
    assertEquals(read[0].record?.data, { theme: "dark" });
  },
});

Deno.test({
  name: "SimpleClient - receive does NOT decompose envelopes",
  fn: async () => {
    const store = new MemoryStore();
    const client = new SimpleClient(store);

    // Even though data looks like an envelope, SimpleClient stores it as-is
    await client.receive([
      ["envelope://test/1", {
        inputs: [],
        outputs: [["mutable://app/x", "hello"]],
      }],
    ]);

    // The envelope data is stored at the envelope URI
    const envelope = await client.read("envelope://test/1");
    assertEquals(envelope[0].success, true);

    // But the output was NOT written — no fan-out
    const output = await client.read("mutable://app/x");
    assertEquals(output[0].success, false);
  },
});

Deno.test({
  name: "SimpleClient - batch receive",
  fn: async () => {
    const store = new MemoryStore();
    const client = new SimpleClient(store);

    const results = await client.receive([
      ["mutable://app/a", "A"],
      ["mutable://app/b", "B"],
      ["mutable://app/c", "C"],
    ]);
    assertEquals(results.length, 3);
    assertEquals(results.every((r) => r.accepted), true);

    const read = await client.read([
      "mutable://app/a",
      "mutable://app/b",
      "mutable://app/c",
    ]);
    assertEquals(read.length, 3);
    assertEquals(read[0].record?.data, "A");
    assertEquals(read[1].record?.data, "B");
    assertEquals(read[2].record?.data, "C");
  },
});

Deno.test({
  name: "SimpleClient - read with string or array",
  fn: async () => {
    const store = new MemoryStore();
    const client = new SimpleClient(store);

    await client.receive([["mutable://app/x", "data"]]);

    // String form
    const r1 = await client.read("mutable://app/x");
    assertEquals(r1[0].record?.data, "data");

    // Array form
    const r2 = await client.read(["mutable://app/x"]);
    assertEquals(r2[0].record?.data, "data");
  },
});

Deno.test({
  name: "SimpleClient - observe emits on successful write",
  fn: async () => {
    const store = new MemoryStore();
    const client = new SimpleClient(store);
    const ac = new AbortController();

    const observed: { uri?: string; data: unknown }[] = [];
    const observePromise = (async () => {
      for await (const result of client.observe("mutable://app/*", ac.signal)) {
        observed.push({ uri: result.uri, data: result.record?.data });
        ac.abort();
      }
    })();

    await client.receive([["mutable://app/x", "hello"]]);
    await observePromise;

    assertEquals(observed, [{ uri: "mutable://app/x", data: "hello" }]);
  },
});

Deno.test({
  name: "SimpleClient - observe works without store.observe (store-agnostic)",
  fn: async () => {
    // Store without observe — observe lives on the client.
    const bareStore: import("./types.ts").Store = {
      write: async (entries) => entries.map(() => ({ success: true })),
      read: async (uris) =>
        uris.map(() => ({ success: false, error: "not found" })),
      delete: async (uris) => uris.map(() => ({ success: true })),
      status: async () => ({ status: "healthy" }),
    };
    const client = new SimpleClient(bareStore);
    const ac = new AbortController();

    const observed: unknown[] = [];
    const done = (async () => {
      for await (const r of client.observe("mutable://x/:k", ac.signal)) {
        observed.push(r.record?.data);
        ac.abort();
      }
    })();

    await client.receive([["mutable://x/a", 42]]);
    await done;
    assertEquals(observed, [42]);
  },
});

Deno.test({
  name: "SimpleClient - observe carries the payload from the write",
  fn: async () => {
    const store = new MemoryStore();
    const client = new SimpleClient(store);
    const ac = new AbortController();

    let seenPayload: unknown;
    const done = (async () => {
      for await (
        const r of client.observe("mutable://tokens/:id", ac.signal)
      ) {
        seenPayload = r.record?.data;
        ac.abort();
      }
    })();

    // Conserved quantities live inside the payload (RFC 001).
    await client.receive([
      ["mutable://tokens/1", {
        values: { fire: 75, usd: 25 },
        label: "payload",
      }],
    ]);
    await done;

    assertEquals(seenPayload, {
      values: { fire: 75, usd: 25 },
      label: "payload",
    });
  },
});

Deno.test({
  name: "SimpleClient - status delegates to store",
  fn: async () => {
    const store = new MemoryStore();
    const client = new SimpleClient(store);

    const status = await client.status();
    assertEquals(status.status, "healthy");
  },
});
