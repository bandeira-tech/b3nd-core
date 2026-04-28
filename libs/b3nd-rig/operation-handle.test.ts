/**
 * Tests for the OperationHandle returned by rig.send / rig.receive.
 *
 * Covers:
 *  - Awaitable: resolves to ReceiveResult[] at pipeline ack time
 *  - Per-stage events: process:done, handle:emit
 *  - Per-route events: route:success, route:error
 *  - settled event + .settled Promise
 *  - receiveOrThrow / sendOrThrow helpers
 *  - OperationHandle scope: events fire only for this operation
 */

import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { Rig } from "./rig.ts";
import { connection } from "./connection.ts";
import { DataStoreClient } from "../b3nd-core/data-store-client.ts";
import { MemoryStore } from "../b3nd-client-memory/store.ts";
import { FunctionalClient } from "../b3nd-core/functional-client.ts";
import type { Output, Program, ReceiveResult } from "../b3nd-core/types.ts";

function memClient() {
  return new DataStoreClient(new MemoryStore());
}

// ── Awaitable behavior ────────────────────────────────────────────────

Deno.test("OperationHandle - await resolves to ReceiveResult[]", async () => {
  const rig = new Rig({
    connections: [connection(memClient(), { receive: ["*"], read: ["*"] })],
  });
  const op = rig.receive([["mutable://open/x", { v: 1 }]]);
  const results = await op;
  assertEquals(Array.isArray(results), true);
  assertEquals(results.length, 1);
  assertEquals(results[0].accepted, true);
});

Deno.test("OperationHandle - rig.send returns OperationHandle", async () => {
  const rig = new Rig({
    connections: [connection(memClient(), { receive: ["*"], read: ["*"] })],
  });
  const op = rig.send([["mutable://open/x", { v: 1 }]]);
  // Has both Promise-like and event-emitter shape.
  assertEquals(typeof op.then, "function");
  assertEquals(typeof op.on, "function");
  assertEquals(typeof op.off, "function");
  const results = await op;
  assertEquals(results[0].accepted, true);
});

// ── Per-stage events ──────────────────────────────────────────────────

Deno.test("OperationHandle - fires process:done per input tuple", async () => {
  const rig = new Rig({
    connections: [connection(memClient(), { receive: ["*"], read: ["*"] })],
  });
  const events: { input: Output; code: string }[] = [];
  const op = rig.receive([
    ["mutable://open/a", { v: 1 }],
    ["mutable://open/b", { v: 2 }],
  ]);
  op.on("process:done", (e) => {
    events.push({ input: e.input, code: e.result.code });
  });
  await op;
  await op.settled;
  assertEquals(events.length, 2);
  assertEquals(events[0].code, "ok");
  assertEquals(events[1].code, "ok");
});

Deno.test("OperationHandle - fires handle:emit with handler emissions", async () => {
  const rig = new Rig({
    connections: [connection(memClient(), { receive: ["*"], read: ["*"] })],
  });
  const events: { input: Output; emissions: Output[] }[] = [];
  const op = rig.receive([["mutable://open/x", { v: 1 }]]);
  op.on("handle:emit", (e) => {
    events.push({ input: e.input, emissions: e.emissions });
  });
  await op;
  await op.settled;
  assertEquals(events.length, 1);
  // Default handler returns the input as-is.
  assertEquals(events[0].emissions.length, 1);
  assertEquals(events[0].emissions[0][0], "mutable://open/x");
});

// ── Per-route events ──────────────────────────────────────────────────

Deno.test("OperationHandle - fires route:success per (emission, connection)", async () => {
  const rig = new Rig({
    connections: [
      connection(memClient(), { receive: ["mutable://*"], read: ["*"] }, {
        id: "primary",
      }),
      connection(memClient(), { receive: ["mutable://*"] }, { id: "mirror" }),
    ],
  });
  const successes: { uri: string; connectionId: string }[] = [];
  const op = rig.receive([["mutable://open/x", { v: 1 }]]);
  op.on("route:success", (e) => {
    successes.push({ uri: e.emission[0], connectionId: e.connectionId });
  });
  await op;
  await op.settled;
  // One emission, two matching connections — two route:success events.
  assertEquals(successes.length, 2);
  const ids = successes.map((s) => s.connectionId).sort();
  assertEquals(ids, ["mirror", "primary"]);
});

Deno.test("OperationHandle - fires route:error when a connection rejects", async () => {
  const failing = new FunctionalClient({
    receive: () => Promise.resolve([{ accepted: false, error: "disk full" }]),
  });
  const rig = new Rig({
    connections: [
      connection(failing, { receive: ["mutable://*"] }, { id: "broken" }),
    ],
  });
  const errors: { uri: string; connectionId: string; error?: string }[] = [];
  const op = rig.receive([["mutable://open/x", { v: 1 }]]);
  op.on("route:error", (e) => {
    errors.push({
      uri: e.emission[0],
      connectionId: e.connectionId,
      error: e.error,
    });
  });
  await op;
  await op.settled;
  assertEquals(errors.length, 1);
  assertEquals(errors[0].connectionId, "broken");
  assertEquals(errors[0].error, "disk full");
});

// ── settled event + .settled Promise ──────────────────────────────────

Deno.test("OperationHandle - .settled resolves after all routes settle", async () => {
  const rig = new Rig({
    connections: [
      connection(memClient(), { receive: ["*"], read: ["*"] }, {
        id: "memory",
      }),
    ],
  });
  const op = rig.receive([["mutable://open/x", { v: 1 }]]);
  await op; // pipeline ack
  const settled = await op.settled;
  assertEquals(settled.results[0].accepted, true);
});

Deno.test("OperationHandle - .settled fires settled event with results", async () => {
  const rig = new Rig({
    connections: [
      connection(memClient(), { receive: ["*"], read: ["*"] }, {
        id: "memory",
      }),
    ],
  });
  let settledResults: ReceiveResult[] | null = null;
  const op = rig.receive([["mutable://open/x", { v: 1 }]]);
  op.on("settled", (e) => {
    settledResults = e.results;
  });
  await op;
  await op.settled;
  assertNotEquals(settledResults, null);
  assertEquals(settledResults![0].accepted, true);
});

// ── Pipeline-level rejection still gives a result; routes don't fire ──

Deno.test(
  "OperationHandle - pipeline-level rejection does not fire route events",
  async () => {
    const reject: Program = () =>
      Promise.resolve({ code: "reject", error: "no" });
    const rig = new Rig({
      connections: [connection(memClient(), { receive: ["*"], read: ["*"] })],
      programs: { "mutable://open": reject },
    });
    const routeEvents: string[] = [];
    const op = rig.receive([["mutable://open/x", { v: 1 }]]);
    op.on("route:success", () => routeEvents.push("success"));
    op.on("route:error", () => routeEvents.push("error"));
    const results = await op;
    await op.settled;
    assertEquals(results[0].accepted, false);
    assertEquals(results[0].error, "no");
    // Pipeline rejected → no dispatch → no route events.
    assertEquals(routeEvents.length, 0);
  },
);

// ── Helpers ───────────────────────────────────────────────────────────

Deno.test("rig.receiveOrThrow - returns results on accept", async () => {
  const rig = new Rig({
    connections: [connection(memClient(), { receive: ["*"], read: ["*"] })],
  });
  const results = await rig.receiveOrThrow([
    ["mutable://open/x", { v: 1 }],
  ]);
  assertEquals(results[0].accepted, true);
});

Deno.test("rig.receiveOrThrow - throws on pipeline rejection", async () => {
  const reject: Program = () =>
    Promise.resolve({ code: "reject", error: "nope" });
  const rig = new Rig({
    connections: [connection(memClient(), { receive: ["*"], read: ["*"] })],
    programs: { "mutable://open": reject },
  });
  await assertRejects(
    () => rig.receiveOrThrow([["mutable://open/x", { v: 1 }]]),
    Error,
    "nope",
  );
});

Deno.test("rig.sendOrThrow - throws on pipeline rejection", async () => {
  const reject: Program = () =>
    Promise.resolve({ code: "reject", error: "nope-send" });
  const rig = new Rig({
    connections: [connection(memClient(), { receive: ["*"], read: ["*"] })],
    programs: { "mutable://open": reject },
  });
  await assertRejects(
    () => rig.sendOrThrow([["mutable://open/x", { v: 1 }]]),
    Error,
    "nope-send",
  );
});

// ── Scope: events fire only for this operation ────────────────────────

Deno.test("OperationHandle - events scoped to this operation only", async () => {
  const rig = new Rig({
    connections: [connection(memClient(), { receive: ["*"], read: ["*"] })],
  });
  const op1 = rig.receive([["mutable://open/a", { v: 1 }]]);
  const op2 = rig.receive([["mutable://open/b", { v: 2 }]]);

  const op1Routes: string[] = [];
  const op2Routes: string[] = [];

  op1.on("route:success", (e) => op1Routes.push(e.emission[0]));
  op2.on("route:success", (e) => op2Routes.push(e.emission[0]));

  await Promise.all([op1, op2]);
  await Promise.all([op1.settled, op2.settled]);

  assertEquals(op1Routes, ["mutable://open/a"]);
  assertEquals(op2Routes, ["mutable://open/b"]);
});

// ── Connection IDs ────────────────────────────────────────────────────

Deno.test("connection - uses provided id", () => {
  const c = connection(memClient(), { receive: ["*"] }, { id: "named" });
  assertEquals(c.id, "named");
});

Deno.test("connection - auto-generates id when omitted", () => {
  const a = connection(memClient(), { receive: ["*"] });
  const b = connection(memClient(), { receive: ["*"] });
  // IDs are stable strings — different connections get different IDs.
  assertNotEquals(a.id, b.id);
  assertEquals(a.id.startsWith("conn-"), true);
  assertEquals(b.id.startsWith("conn-"), true);
});
