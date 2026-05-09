/**
 * MemoryStore Tests
 *
 * Runs the shared Store test suite + MemoryStore-specific tests.
 * Observe is a client concern (see ObserveEmitter) — not tested here.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "@std/assert";
import { runSharedStoreSuite } from "../b3nd-testing/shared-store-suite.ts";
import { MemoryStore } from "./store.ts";

// ── Shared suite ──────────────────────────────────────────────────

runSharedStoreSuite("MemoryStore", {
  create: () => new MemoryStore(),
});

// ── Capabilities ──────────────────────────────────────────────────

Deno.test({
  name: "MemoryStore - capabilities shape",
  fn: () => {
    const store = new MemoryStore();
    const caps = store.capabilities();
    assertEquals(caps.atomicBatch, false);
    assertEquals(caps.binaryData, false);
  },
});

// ── fn dispatcher: read / ls / count / x-* ────────────────────────

import { count, list, listUris, x } from "../b3nd-core/url.ts";

async function seedUsers(): Promise<MemoryStore> {
  const s = new MemoryStore();
  await s.write([
    { uri: "mutable://app/users/alice", data: { age: 30 } },
    { uri: "mutable://app/users/bob", data: { age: 25 } },
    { uri: "mutable://app/users/carol", data: { age: 40 } },
  ]);
  return s;
}

Deno.test("MemoryStore.read - fn=read returns single record", async () => {
  const s = await seedUsers();
  const [r] = await s.read(["mutable://app/users/alice"]);
  assertEquals(r?.[1], { age: 30 });
});

Deno.test("MemoryStore.read - fn=ls returns full records by default", async () => {
  const s = await seedUsers();
  const results = await s.read([list("mutable://app/users")]);
  assertEquals(results.length, 3);
  for (const r of results) {
    assertEquals(typeof r[0], "string");
    assertEquals(typeof r?.[1], "object");
  }
});

Deno.test("MemoryStore.read - fn=ls format=uris omits records", async () => {
  const s = await seedUsers();
  const results = await s.read([listUris("mutable://app/users")]);
  assertEquals(results.length, 3);
  for (const r of results) {
    assertEquals(typeof r[0], "string");
    assertEquals(r?.[1], undefined);
  }
});

Deno.test("MemoryStore.read - fn=ls limit + page slices results", async () => {
  const s = await seedUsers();
  const page1 = await s.read([
    list("mutable://app/users", { limit: 2, page: 1, sortBy: "uri" }),
  ]);
  const page2 = await s.read([
    list("mutable://app/users", { limit: 2, page: 2, sortBy: "uri" }),
  ]);
  assertEquals(page1.length, 2);
  assertEquals(page2.length, 1);
  assertEquals(page1[0][0], "mutable://app/users/alice");
  assertEquals(page1[1][0], "mutable://app/users/bob");
  assertEquals(page2[0][0], "mutable://app/users/carol");
});

Deno.test("MemoryStore.read - fn=ls sortOrder=desc reverses", async () => {
  const s = await seedUsers();
  const results = await s.read([
    list("mutable://app/users", { sortBy: "uri", sortOrder: "desc" }),
  ]);
  assertEquals(results.map((r) => r[0]), [
    "mutable://app/users/carol",
    "mutable://app/users/bob",
    "mutable://app/users/alice",
  ]);
});

Deno.test("MemoryStore.read - fn=count matches ls length", async () => {
  const s = await seedUsers();
  const [c] = await s.read([count("mutable://app/users")]);
  assertEquals(c?.[1], 3);
});

Deno.test("MemoryStore.read - fn=count over empty prefix returns 0", async () => {
  const s = new MemoryStore();
  const [c] = await s.read([count("mutable://nothing/here")]);
  assertEquals(c?.[1], 0);
});

Deno.test("MemoryStore.read - unsupported pattern throws", async () => {
  const s = await seedUsers();
  let threw = false;
  try {
    await s.read([list("mutable://app/users", { pattern: "a*" })]);
  } catch (e) {
    threw = true;
    assertEquals(/pattern/.test(String(e)), true);
  }
  assertEquals(threw, true);
});

Deno.test("MemoryStore.read - x-* fn throws unsupported", async () => {
  const s = await seedUsers();
  let threw = false;
  try {
    await s.read([x("mutable://app/users/", "x-pg.scan")]);
  } catch (e) {
    threw = true;
    assertEquals(/unsupported fn/.test(String(e)), true);
  }
  assertEquals(threw, true);
});

Deno.test("MemoryStore.status - advertises supported fns", async () => {
  const s = new MemoryStore();
  const status = await s.status();
  assertEquals(status.fns, ["read", "ls", "count"]);
});

Deno.test("MemoryStore.read - heterogeneous batch (read + count + ls)", async () => {
  const s = await seedUsers();
  const results = await s.read([
    "mutable://app/users/alice",
    count("mutable://app/users"),
    listUris("mutable://app/users", { sortBy: "uri" }),
  ]);
  // 1 read + 1 count + 3 ls items = 5 results
  assertEquals(results.length, 5);
  assertEquals(results[0]?.[1], { age: 30 });
  assertEquals(results[1]?.[1], 3);
  assertEquals(
    results.slice(2).map((r) => r[0]),
    [
      "mutable://app/users/alice",
      "mutable://app/users/bob",
      "mutable://app/users/carol",
    ],
  );
});
