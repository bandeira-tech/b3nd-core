/**
 * ConsoleClient Tests
 *
 * ConsoleClient is a write-only transport client — it logs receive
 * operations but reads always return errors.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "@std/assert";
import { ConsoleClient } from "./client.ts";

Deno.test("ConsoleClient - receive logs messages and returns accepted", async () => {
  const logs: string[] = [];
  const client = new ConsoleClient("debug", (msg: string) => logs.push(msg));

  const results = await client.receive([
    ["mutable://app/config", { values: { fire: 10 }, theme: "dark" }],
  ]);

  assertEquals(results.length, 1);
  assertEquals(results[0].accepted, true);
  assertEquals(logs.length, 1);
  assertEquals(logs[0].includes("[debug] RECEIVE"), true);
  assertEquals(logs[0].includes("mutable://app/config"), true);
});

Deno.test("ConsoleClient - receive handles multiple messages", async () => {
  const logs: string[] = [];
  const client = new ConsoleClient("test", (msg: string) => logs.push(msg));

  const results = await client.receive([
    ["mutable://a", "data-a"],
    ["mutable://b", "data-b"],
    ["mutable://c", "data-c"],
  ]);

  assertEquals(results.length, 3);
  assertEquals(results.every((r) => r.accepted), true);
  assertEquals(logs.length, 3);
});

Deno.test("ConsoleClient - read returns no Output (write-only)", async () => {
  // ConsoleClient is write-only. Under option-A absence semantics,
  // every read produces no Output rather than a failure result.
  const client = new ConsoleClient("test");

  const single = await client.read(["mutable://a"]);
  assertEquals(single.length, 0);

  const multi = await client.read([
    "mutable://a",
    "mutable://b",
    "mutable://c",
  ]);
  assertEquals(multi.length, 0);
});

Deno.test("ConsoleClient - status returns healthy", async () => {
  const client = new ConsoleClient("test");

  const status = await client.status();

  assertEquals(status.status, "healthy");
});

Deno.test("ConsoleClient - observe returns empty async iterable", async () => {
  const client = new ConsoleClient("test");

  const items: unknown[] = [];
  for await (const item of client.observe(["mutable://test/"])) {
    items.push(item);
  }

  assertEquals(items.length, 0);
});

Deno.test("ConsoleClient - handles unserializable data gracefully", async () => {
  const logs: string[] = [];
  const client = new ConsoleClient("test", (msg: string) => logs.push(msg));

  // Create circular reference
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  const results = await client.receive([
    ["mutable://test", circular],
  ]);

  assertEquals(results.length, 1);
  assertEquals(results[0].accepted, true);
  assertEquals(logs[0].includes("[unserializable]"), true);
});

Deno.test("ConsoleClient - default label is 'b3nd'", async () => {
  const logs: string[] = [];
  const client = new ConsoleClient(undefined, (msg: string) => logs.push(msg));

  await client.receive([["mutable://x", null]]);

  assertEquals(logs[0].includes("[b3nd]"), true);
});
