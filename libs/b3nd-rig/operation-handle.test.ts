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
  const _route19 = connection(memClient(), ["*"]);
  const rig = new Rig({
    routes: {
      receive: [_route19],
      read: [_route19],
    },
  });
  const op = rig.receive([["mutable://open/x", { v: 1 }]]);
  const results = await op;
  assertEquals(Array.isArray(results), true);
  assertEquals(results.length, 1);
  assertEquals(results[0].accepted, true);
});

Deno.test("OperationHandle - rig.send returns OperationHandle", async () => {
  const _route20 = connection(memClient(), ["*"]);
  const rig = new Rig({
    routes: {
      receive: [_route20],
      read: [_route20],
    },
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
  const _route21 = connection(memClient(), ["*"]);
  const rig = new Rig({
    routes: {
      receive: [_route21],
      read: [_route21],
    },
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
  const _route22 = connection(memClient(), ["*"]);
  const rig = new Rig({
    routes: {
      receive: [_route22],
      read: [_route22],
    },
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
  const primary = memClient();
  const primaryReceive = connection(primary, ["mutable://*"], { id: "primary" });
  const primaryRead = connection(primary, ["*"], { id: "primary" });
  const mirror = connection(memClient(), ["mutable://*"], { id: "mirror" });
  const rig = new Rig({
    routes: {
      receive: [primaryReceive, mirror],
      read: [primaryRead],
    },
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
  const _route23 = connection(failing, ["mutable://*"], { id: "broken" });
  const rig = new Rig({
    routes: {
      receive: [_route23],
    },
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
  const _route24 = connection(memClient(), ["*"], {
        id: "memory",
      });
  const rig = new Rig({
    routes: {
      receive: [_route24],
      read: [_route24],
    },
  });
  const op = rig.receive([["mutable://open/x", { v: 1 }]]);
  await op; // pipeline ack
  const settled = await op.settled;
  assertEquals(settled.results[0].accepted, true);
});

Deno.test("OperationHandle - .settled fires settled event with results", async () => {
  const _route25 = connection(memClient(), ["*"], {
        id: "memory",
      });
  const rig = new Rig({
    routes: {
      receive: [_route25],
      read: [_route25],
    },
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
    const _route26 = connection(memClient(), ["*"]);
    const rig = new Rig({
      routes: {
        receive: [_route26],
        read: [_route26],
      },
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
  const _route27 = connection(memClient(), ["*"]);
  const rig = new Rig({
    routes: {
      receive: [_route27],
      read: [_route27],
    },
  });
  const results = await rig.receiveOrThrow([
    ["mutable://open/x", { v: 1 }],
  ]);
  assertEquals(results[0].accepted, true);
});

Deno.test("rig.receiveOrThrow - throws on pipeline rejection", async () => {
  const reject: Program = () =>
    Promise.resolve({ code: "reject", error: "nope" });
  const _route28 = connection(memClient(), ["*"]);
  const rig = new Rig({
    routes: {
      receive: [_route28],
      read: [_route28],
    },
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
  const _route29 = connection(memClient(), ["*"]);
  const rig = new Rig({
    routes: {
      receive: [_route29],
      read: [_route29],
    },
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
  const _route30 = connection(memClient(), ["*"]);
  const rig = new Rig({
    routes: {
      receive: [_route30],
      read: [_route30],
    },
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
  const c = connection(memClient(), ["*"], { id: "named" });
  assertEquals(c.id, "named");
});

Deno.test("connection - auto-generates id when omitted", () => {
  const a = connection(memClient(), ["*"]);
  const b = connection(memClient(), ["*"]);
  // IDs are stable strings — different connections get different IDs.
  assertNotEquals(a.id, b.id);
  assertEquals(a.id.startsWith("conn-"), true);
  assertEquals(b.id.startsWith("conn-"), true);
});

// ── process:error event ───────────────────────────────────────────────

Deno.test("OperationHandle - fires process:error when program throws", async () => {
  const throwingProgram: Program = () => {
    throw new Error("program crashed");
  };
  const c = connection(memClient(), ["*"]);
  const rig = new Rig({
    routes: { receive: [c], read: [c] },
    programs: { "mutable://open": throwingProgram },
  });
  const errors: { uri: string; error: string }[] = [];
  const op = rig.receive([["mutable://open/x", { v: 1 }]]);
  op.on("process:error", (e) => {
    errors.push({ uri: e.input[0], error: e.error });
  });
  const results = await op;
  assertEquals(errors.length, 1);
  assertEquals(errors[0].uri, "mutable://open/x");
  assertEquals(errors[0].error, "program crashed");
  assertEquals(results[0].accepted, false);
});

Deno.test("OperationHandle - fires process:error when program returns error code", async () => {
  const reject: Program = () =>
    Promise.resolve({ code: "rejected", error: "policy denied" });
  const c = connection(memClient(), ["*"]);
  const rig = new Rig({
    routes: { receive: [c], read: [c] },
    programs: { "mutable://open": reject },
  });
  const errors: string[] = [];
  const op = rig.receive([["mutable://open/x", { v: 1 }]]);
  op.on("process:error", (e) => errors.push(e.error));
  await op;
  assertEquals(errors, ["policy denied"]);
});

Deno.test("OperationHandle - fires process:error when no connection accepts", async () => {
  const c = connection(memClient(), ["local://*"]);
  const rig = new Rig({ routes: { receive: [c] } });
  const errors: string[] = [];
  const op = rig.receive([["mutable://open/x", { v: 1 }]]);
  op.on("process:error", (e) => errors.push(e.error));
  const results = await op;
  assertEquals(errors.length, 1);
  assertEquals(errors[0].includes("No connection accepts"), true);
  assertEquals(results[0].accepted, false);
});

// ── handle:error event ────────────────────────────────────────────────

Deno.test("OperationHandle - fires handle:error when handler throws", async () => {
  const okProgram: Program = () => Promise.resolve({ code: "boom" });
  const c = connection(memClient(), ["*"]);
  const rig = new Rig({
    routes: { receive: [c], read: [c] },
    programs: { "mutable://open": okProgram },
    handlers: {
      "boom": () => {
        throw new Error("handler crashed");
      },
    },
  });
  const errors: { uri: string; error: string; code: string }[] = [];
  const op = rig.receive([["mutable://open/x", { v: 1 }]]);
  op.on("handle:error", (e) => {
    errors.push({
      uri: e.input[0],
      error: e.error,
      code: e.classification.code,
    });
  });
  const results = await op;
  assertEquals(errors.length, 1);
  assertEquals(errors[0].uri, "mutable://open/x");
  assertEquals(errors[0].code, "boom");
  assertEquals(errors[0].error, "handler crashed");
  assertEquals(results[0].accepted, false);
});

// ── reaction:error event ──────────────────────────────────────────────

Deno.test("OperationHandle - fires reaction:error when reaction throws", async () => {
  const c = connection(memClient(), ["*"]);
  const rig = new Rig({
    routes: { receive: [c], read: [c] },
    reactions: {
      "mutable://open/:id": () => {
        throw new Error("reaction crashed");
      },
    },
  });
  const errors: { uri: string; pattern: string; error: string }[] = [];
  const op = rig.receive([["mutable://open/x", { v: 1 }]]);
  op.on("reaction:error", (e) => {
    errors.push({
      uri: e.emission[0],
      pattern: e.pattern,
      error: e.error,
    });
  });
  await op;
  await op.settled;
  assertEquals(errors.length, 1);
  assertEquals(errors[0].uri, "mutable://open/x");
  assertEquals(errors[0].pattern, "mutable://open/:id");
  assertEquals(errors[0].error, "reaction crashed");
});

// ── onError hook — observation ───────────────────────────────────────

Deno.test("onError hook - fires for process error (program throw)", async () => {
  const seen: { phase: string; error: string }[] = [];
  const c = connection(memClient(), ["*"]);
  const rig = new Rig({
    routes: { receive: [c], read: [c] },
    programs: {
      "mutable://open": () => {
        throw new Error("p crashed");
      },
    },
    hooks: {
      onError: (ctx) => {
        seen.push({ phase: ctx.phase, error: ctx.error });
      },
    },
  });
  const op = rig.receive([["mutable://open/x", { v: 1 }]]);
  await op;
  assertEquals(seen.length, 1);
  assertEquals(seen[0].phase, "process");
  assertEquals(seen[0].error, "p crashed");
});

Deno.test("onError hook - fires for handle error (handler throw)", async () => {
  const seen: string[] = [];
  const c = connection(memClient(), ["*"]);
  const rig = new Rig({
    routes: { receive: [c], read: [c] },
    programs: { "mutable://open": () => Promise.resolve({ code: "go" }) },
    handlers: {
      "go": () => {
        throw new Error("h crashed");
      },
    },
    hooks: {
      onError: (ctx) => {
        seen.push(`${ctx.phase}:${ctx.error}`);
      },
    },
  });
  const op = rig.receive([["mutable://open/x", { v: 1 }]]);
  await op;
  assertEquals(seen, ["handle:h crashed"]);
});

Deno.test("onError hook - fires for route error (connection rejects)", async () => {
  const failing = new FunctionalClient({
    receive: () => Promise.resolve([{ accepted: false, error: "disk full" }]),
  });
  const c = connection(failing, ["*"], { id: "broken" });
  const seen: { phase: string; connectionId?: string; error: string }[] = [];
  const rig = new Rig({
    routes: { receive: [c] },
    hooks: {
      onError: (ctx) => {
        seen.push({
          phase: ctx.phase,
          connectionId: ctx.connectionId,
          error: ctx.error,
        });
      },
    },
  });
  const op = rig.receive([["mutable://open/x", { v: 1 }]]);
  await op;
  await op.settled;
  assertEquals(seen.length, 1);
  assertEquals(seen[0].phase, "route");
  assertEquals(seen[0].connectionId, "broken");
  assertEquals(seen[0].error, "disk full");
});

Deno.test("onError hook - fires for reaction error", async () => {
  const seen: { phase: string; pattern?: string; error: string }[] = [];
  const c = connection(memClient(), ["*"]);
  const rig = new Rig({
    routes: { receive: [c], read: [c] },
    reactions: {
      "mutable://open/:id": () => {
        throw new Error("react crashed");
      },
    },
    hooks: {
      onError: (ctx) => {
        seen.push({
          phase: ctx.phase,
          pattern: ctx.pattern,
          error: ctx.error,
        });
      },
    },
  });
  const op = rig.receive([["mutable://open/x", { v: 1 }]]);
  await op;
  await op.settled;
  assertEquals(seen.length, 1);
  assertEquals(seen[0].phase, "reaction");
  assertEquals(seen[0].pattern, "mutable://open/:id");
  assertEquals(seen[0].error, "react crashed");
});

// ── onError hook — abort by throwing ─────────────────────────────────

Deno.test("onError hook - throw aborts the operation (process phase)", async () => {
  const c = connection(memClient(), ["*"]);
  const rig = new Rig({
    routes: { receive: [c], read: [c] },
    programs: {
      "mutable://open": () => {
        throw new Error("p crashed");
      },
    },
    hooks: {
      onError: () => {
        throw new Error("aborting");
      },
    },
  });
  await assertRejects(
    () => Promise.resolve(rig.receive([["mutable://open/x", { v: 1 }]])),
    Error,
    "aborting",
  );
});

Deno.test("onError hook - throw on first tuple stops batch processing", async () => {
  // Two tuples, the first triggers a program error. The hook throws,
  // so the second should never be processed.
  const c = connection(memClient(), ["*"]);
  const rig = new Rig({
    routes: { receive: [c], read: [c] },
    programs: {
      "mutable://open/bad": () =>
        Promise.resolve({ code: "rej", error: "bad input" }),
      "mutable://open/good": () => Promise.resolve({ code: "ok" }),
    },
    hooks: {
      onError: () => {
        throw new Error("stop everything");
      },
    },
  });
  await assertRejects(
    () =>
      Promise.resolve(
        rig.receive([
          ["mutable://open/bad", {}],
          ["mutable://open/good", {}],
        ]),
      ),
    Error,
    "stop everything",
  );
});

Deno.test("onError hook - return (no throw) lets pipeline keep going", async () => {
  // Two tuples, the first triggers a program error. The hook records
  // it but doesn't throw — the second tuple should still be processed.
  const seen: string[] = [];
  const c = connection(memClient(), ["*"]);
  const rig = new Rig({
    routes: { receive: [c], read: [c] },
    programs: {
      "mutable://open/bad": () =>
        Promise.resolve({ code: "rej", error: "bad input" }),
      "mutable://open/good": () => Promise.resolve({ code: "ok" }),
    },
    hooks: {
      onError: (ctx) => {
        seen.push(ctx.error);
      },
    },
  });
  const results = await rig.receive([
    ["mutable://open/bad", {}],
    ["mutable://open/good", {}],
  ]);
  assertEquals(results.length, 2);
  assertEquals(results[0].accepted, false);
  assertEquals(results[1].accepted, true);
  assertEquals(seen, ["bad input"]);
});
